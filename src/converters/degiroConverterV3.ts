import dayjs from "dayjs";
import * as crypto from "crypto";
import { parse } from "csv-parse";
import { DeGiroRecord } from "../models/degiroRecord";
import { AbstractConverter } from "./abstractconverter";
import { SecurityService } from "../securityService";
import { GhostfolioExport } from "../models/ghostfolioExport";
import YahooFinanceRecord from "../models/yahooFinanceRecord";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { GhostfolioActivity } from "../models/ghostfolioActivity";
import { GhostfolioOrderType } from "../models/ghostfolioOrderType";

export class DeGiroConverterV3 extends AbstractConverter {

  constructor(securityService: SecurityService) {
    super(securityService);

    dayjs.extend(customParseFormat);
  }

  /**
   * @inheritdoc
   */
  public processFileContents(input: string, successCallback: any, errorCallback: any): void {
    // my exported file contained many broken records like this. It's easy to recover them. So, why not?!
    // 13-04-2016,09:00,13-04-2016,ABN AMRO BANK NV,NL0011540547,"Koop 10 @ 18,3 EUR",,EUR,-183.00,EUR,,df134e52-2753-4694-
    // ,,,,,,,,,,,947b-418f08d4a352
    input = input.replace(/(,[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-)\n,{11}([a-f0-9]{4}-[a-f0-9]{12})$/mg, '$1$2');

    // Parse the CSV and convert to Ghostfolio import format.
    parse(input, {
      delimiter: ",",
      fromLine: 2,
      columns: this.processHeaders(input),
      cast: (columnValue, context) => {

        // Custom mapping below.

        if (context.column === "currency" && columnValue === "GBX") {
          return "GBp";
        }

        return columnValue;
      }
    }, async (err, plainRecords: DeGiroRecord[]) => {

      // Check if parsing failed..
      if (err || plainRecords === undefined || plainRecords.length === 0) {
        let errorMsg = "An error ocurred while parsing!";

        if (err) {
          errorMsg += ` Details: ${err.message}`

          // Temporary error check for Transactions.csv
          if (err.message.indexOf("length is 12, got 19")) {
            console.warn("[i] Detecting wrong input format. Have you exported the correct CSV file?");
            console.warn("[i] Export to Ghostfolio only supports Account.csv, not Transactions.csv!");
            console.warn("[i] See the export instructions in the README at https://git.new/JjA86vv");
          }
        }

        return errorCallback(new Error(errorMsg))
      }

      console.log("[i] Read CSV file. Start processing..");
      const result: GhostfolioExport = {
        meta: {
          date: new Date(),
          version: "v0"
        },
        activities: []
      };

      // Inverse records so they come in the chronological order. This is very important since
      // selecion of security should happe based on buy/sell records, and not dividend/fee records.
      // By default DeGiro's CSV file has the most recent records at the top. So, by inversing
      // the order we process records in choronological order but keep internal releationships
      // between records which we can break if, for instance, sort by date/time.
      plainRecords.reverse();

      // Map plain objects to DeGiroRecord instances
      const records = plainRecords.map(record => DeGiroRecord.fromPlainObject(record));

      // Populate the progress bar.
      const bar1 = this.progress.create(records.length, 0);

      // HashSet to skip processed records
      const processedRecords = new Set<string>();

      for (let idx = 0; idx < records.length; idx++) {
        const record = records[idx];

        // Check if the record should be ignored. 
        if (this.isIgnoredRecord(record)) {
          bar1.increment();
          continue;
        }

        // Check if the current record was already processed.
        const recordHash = this.hashRecord(record);
        if (processedRecords.has(recordHash)) {
            bar1.increment();
            continue
        }

        processedRecords.add(recordHash);

        // TODO: Is is possible to add currency? So VWRL.AS is retrieved for IE00B3RBWM25 instead of VWRL.L.
        // Maybe add yahoo-finance2 library that Ghostfolio uses, so I dont need to call Ghostfolio for this.

        // Platform fees do not have a security, add those immediately.
        if (this.isPlatformFees(record)) {
          result.activities.push(this.mapPlatformFeeRecord(record));
          bar1.increment(1);
          continue;
        }

        // Interest does not have a security, add it immediately.
        if (this.isInterest(record)) {
          result.activities.push(this.mapInterestRecord(record));
          bar1.increment(1);
          continue;
        }

        // Look for the security for the current record.
        let security: YahooFinanceRecord;
        try {
          security = await this.securityService.getSecurity(
            record.isin,
            null,
            record.product,
            record.currency,
            this.progress);
        }
        catch (err) {
          this.logQueryError(record.isin || record.product, idx);
          return errorCallback(err);
        }

        // Log whenever there was no match found.
        if (!security) {
          this.progress.log(`[i] No result found for ${record.isin || record.product} with currency ${record.currency}! Please add this manually..\n`);
          bar1.increment();
          continue;
        }

        // Look ahead in the remaining records if there are some with the same orderId.
        let matchingRecords = [];
        if (record.orderId) {
          matchingRecords = this.findMatchesByOrderId(record, records.slice(idx + 1));
        }

        // If there was no match by orderId, and there was no orderId present on the current record, look ahead one record to find a match by ISIN + Product + Date.
        if (matchingRecords.length == 0 && !record.orderId) {
          matchingRecords = this.findMatchByIsinSameDateTime(record, records.slice(idx + 1, idx + 2));
        }

        // Filter out ignored records
        matchingRecords = matchingRecords.filter(r => !this.isIgnoredRecord(r));

        // Register records as processed so they are skipped on next iteration(s)
        matchingRecords.forEach(r => processedRecords.add(this.hashRecord(r)));

        if (matchingRecords.length == 0) {
          // If it's a standalone record, add it immediately.
          const mappedRecord = this.mapStandaloneRecord(record, security);
          if (mappedRecord) result.activities.push(mappedRecord);

          bar1.increment(1);
          continue;
        }

        // Now, need to check that all records uses the same currency.
        // If not, we have to report them separately even though they are part of one operation in DeGiro
        const sameCurrency = matchingRecords.every(r => r.currency == record.currency);
        if (!sameCurrency) {
          matchingRecords.unshift(record); // combine records to work with them as one whole
          matchingRecords.forEach(r => {
            const mr = this.mapStandaloneRecord(r, security);
            if (mr) result.activities.push(mr);
          })

          bar1.increment(1);
          continue;
        }

        // Okay, we're dealing with a set of records of the same currency.
        // We can combined them and report as one (or multiple records).
        matchingRecords.unshift(record); // combine records to work with them as one whole

        // Get main and fees records
        const mainRecords = matchingRecords.filter(r => this.isBuyOrSellRecord(r) || this.isDividendRecord(r));
        let transactionFeeRecords = matchingRecords.filter(r => this.isTransactionFeeRecord(r));

        if (mainRecords.length == 0 || matchingRecords.length != mainRecords.length + transactionFeeRecords.length) {
          this.progress.log(`[i] Unexpected set of ${matchingRecords.length} records (see below)! Please add them manually..\n`);
          matchingRecords.forEach(r => this.progress.log(`Record ${r.isin || r.product} from ${r.date} with ${r.amount}${r.currency}`));

          bar1.increment();
          continue;
        }

        // if there is one main record, report it combined with transaction fee(s). All other goes without TX fee.
        mainRecords.forEach(r => {
          if (this.isBuyOrSellRecord(r)) {
            result.activities.push(this.mapBuySellRecord(r, transactionFeeRecords, security));
          } else {
            result.activities.push(this.mapDividendRecord(r, transactionFeeRecords, security));
          }

          transactionFeeRecords = []; // nullify tx after first iteration
        });

        bar1.increment();
      }

      this.progress.stop();

      successCallback(result);
    });
  }

  /**
   * @inheritdoc
   */
  protected processHeaders(_: string): string[] {

    // Generic header mapping from the DEGIRO CSV export.
    const csvHeaders = [
      "date",
      "time",
      "currencyDate",
      "product",
      "isin",
      "description",
      "fx",
      "currency",
      "amount",
      "balance_currency",
      "balance",
      "orderId"];

    return csvHeaders;
  }

  /**
   * @inheritdoc
   */
  public isIgnoredRecord(record: DeGiroRecord): boolean {

    if (record.description === "") {
      return true;
    }

    // Record without date/time/product/isin should also be ignored.
    if (!record.date && !record.time && !record.product && !record.isin) {
      return true;
    }

    // Sometimes there are records like the following. They happen when an ETF changes ISIN.
    // They have zero value and zero price. Let's ignore them
    // 06-10-2022,10:13,06-10-2022,ETC ISSUANCE GMBH,DE000A3G01J0,WIJZIGING ISIN: Koop 12 @ 0 EUR,,EUR,0.00,EUR,
    // 06-10-2022,08:16,14-09-2022,ETC ISSUANCE ETHETC - PHYSICAL,DE000A3G01J0,SPIN-OFF: Koop 12 @ 0 EUR,,EUR,0.00,EUR,
    // 05-10-2022,15:43,14-09-2022,ETC ISSUANCE ETHETC - PHYSICAL,DE000A3G01J0,CLAIMEMISSIE: Verkoop 12 @ 0 EUR,,EUR,0.00,EUR,
    // 05-10-2022,11:09,14-09-2022,ETC ISSUANCE ETHETC - PHYSICAL,DE000A3G01J0,CLAIMEMISSIE: Koop 12 @ 0 EUR,,EUR,0.00,EUR,
    if (record.getAbsoluteAmount() == 0 && !record.fx) {
      return true;
    }

    const ignoredRecordTypes = [
      "ideal",
      "flatex",
      "cash sweep",
      "withdrawal",
      "productwijziging",
      "compensatie",
      "terugstorting",
      "geldmarktfonds",
      "overboeking",
      "währungswechsel",
      "trasferisci",
      "deposito",
      "credito",
      "credit",
      "prelievo",
      "creditering",
      "debitering",
      "rente",
      "interesse",
      "verrekening promotie",
      "operation de change",
      "versement de fonds",
      "débit",
      "debit",
      "depósito",
      "ingreso",
      "retirada",
      "levantamento de divisa",
      "dito de divisa",
      "fonds monétaires"];

    return ignoredRecordTypes.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private findMatchesByOrderId(currentRecord: DeGiroRecord, records: DeGiroRecord[]): DeGiroRecord[] | undefined {
    return records.filter(r => r.orderId === currentRecord.orderId);
  }

  private findMatchByIsinSameDateTime(currentRecord: DeGiroRecord, records: DeGiroRecord[]): DeGiroRecord[] | undefined {
    return records.filter(r => r.isin === currentRecord.isin && r.product === currentRecord.product && r.date == currentRecord.date);
  }

  private mapTransactionFeeRecord(record: DeGiroRecord, security?: YahooFinanceRecord): GhostfolioActivity {
    const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");
    const feeAmount = record.getAbsoluteAmount();

    const currency = this.getCurrencyIfConvertable(record.currency, security.currency)
    const convertedFeeAmount = this.convertCurrencyIfConvertable(feeAmount, record.currency, security.currency);

    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: record.orderId,
      fee: this.formatFloat(convertedFeeAmount),
      quantity: 1,
      type: GhostfolioOrderType.fee,
      unitPrice: 0,
      currency: currency,
      dataSource: "MANUAL",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      // ghostfolio doesn't like two MANUAL records with same name, hence adding date & time.
      symbol: `Transaction fee ${security.symbol} @ ${record.date}T${record.time}`
    };
  }

  private mapBuySellRecord(record: DeGiroRecord, transactionFeeRecords: DeGiroRecord[], security?: YahooFinanceRecord): GhostfolioActivity {
    // !IMPORTANT It's assumed that all records (record + transactionFeeRecords) have same currency

    const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");

    /* Get the amount and unit price of shares from the description.
     * For buy/sale records, only the total amount is recorded. So the unit price needs to be calculated.
     * However, in the modern days degiro csv both quantity and price-per-unit are reported.
     * Ex: Verkoop 1 @ 16,78 USD
     * Ex: Koop 475 @ 583,5 GBX
     *
     * At the same time, we can't use the unit price because it may come with a different "currency".
     * "Currency" is in quotes because it's the case between GBP and GBp/GBX. 1 GBP = 100 * GBp/GBX.
     * So, it's not really a difference currency, but rather a different denomination.
     * Yet, it makes it necessary to do the dance with dividing total amount by num of shares.
     * Ex:
     * 03-03-2020,11:14,03-03-2020,ISHARES GLOBAL CLEAN ENERGY UCITS ETF,IE00B1XNHC34,"Koop 475 @ 583,5 GBX",,GBP,-2771.63,GBP,,3b000105-xxxx-xxxx-xxxx-xxxxxxxxxxxx
     *
     * Another note: the old code contained regexp:
     * record.description.match(/([\d*\.?\,?\d*]+)/)[0]
     *
     * This regexp seems broken to me. Confirmed by ChatGPT.
     * I have no idea how it managed to work.
     */

    const num = record.description.match(/([0-9]+[.,]?[0-9]*)/)[0];
    const quantity = parseFloat(num);
    const unitPrice = record.getAbsoluteAmount() / quantity;

    // If amount is negative (so money has been removed)
    const orderType = record.getAmount() < 0 ? GhostfolioOrderType.buy : GhostfolioOrderType.sell;

    // Extract the fee from the transaction fee record and put it in the action record.
    const feeAmount = transactionFeeRecords.reduce((sum, r) => sum + r.getAbsoluteAmount(), 0);

    const currency = this.getCurrencyIfConvertable(record.currency, security.currency)
    const convertedFeeAmount = this.convertCurrencyIfConvertable(feeAmount, record.currency, security.currency);
    const convertedUnitPrice = this.convertCurrencyIfConvertable(unitPrice, record.currency, security.currency);

    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: record.orderId ?? `${orderType === GhostfolioOrderType.buy ? "Buy" : "Sell"} ${record.isin} @ ${record.date}T${record.time}`,
      fee: this.formatFloat(convertedFeeAmount),
      quantity: this.formatFloat(quantity),
      type: orderType,
      unitPrice: this.formatFloat(convertedUnitPrice),
      currency: currency,
      dataSource: "YAHOO",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      symbol: security.symbol ?? "",
    };
  }

  private mapDividendRecord(record: DeGiroRecord, transactionFeeRecords: DeGiroRecord[], security: YahooFinanceRecord): GhostfolioActivity {
    // !IMPORTANT It's assumed that all records (record + transactionFeeRecords) have same currency

    const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");
    const unitPrice = record.getAbsoluteAmount();
    const feeAmount = transactionFeeRecords.reduce((sum, r) => sum + r.getAbsoluteAmount(), 0);

    const currency = this.getCurrencyIfConvertable(record.currency, security.currency)
    const convertedFeeAmount = this.convertCurrencyIfConvertable(feeAmount, record.currency, security.currency);
    const convertedUnitPrice = this.convertCurrencyIfConvertable(unitPrice, record.currency, security.currency);

    // Create the record.
    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: `Dividend ${record.isin} @ ${record.date}T${record.time}`,
      fee: this.formatFloat(convertedFeeAmount),
      quantity: 1,
      type: GhostfolioOrderType.dividend,
      unitPrice: this.formatFloat(convertedUnitPrice),
      currency: currency,
      dataSource: "YAHOO",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      symbol: security.symbol,
    };
  }

  private mapStandaloneRecord(record: DeGiroRecord, security?: YahooFinanceRecord): GhostfolioActivity {
    if (this.isBuyOrSellRecord(record))
      return this.mapBuySellRecord(record, [], security);

    if (this.isDividendRecord(record))
      return this.mapDividendRecord(record, [], security);

    if (this.isTransactionFeeRecord(record))
      // sometimes there are standalone transaction fee records
      return this.mapTransactionFeeRecord(record, security);

    this.progress.log(`[i] Unknown standalone record ${record.isin || record.product} from ${record.date} with ${record.amount}${record.currency}! Please add this manually..\n`);
    return undefined;
  }

  private mapPlatformFeeRecord(record: DeGiroRecord): GhostfolioActivity {
    const feeAmount = record.getAbsoluteAmount();
    const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");
    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: "",
      fee: this.formatFloat(feeAmount),
      quantity: 1,
      type: GhostfolioOrderType.fee,
      unitPrice: 0,
      currency: record.currency,
      dataSource: "MANUAL",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      symbol: record.description
    };
  }

  private mapInterestRecord(record: DeGiroRecord): GhostfolioActivity {
    const interestAmount = record.getAbsoluteAmount();
    const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");
    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: "",
      fee: 0,
      quantity: 1,
      type: GhostfolioOrderType.interest,
      unitPrice: this.formatFloat(interestAmount),
      currency: record.currency,
      dataSource: "MANUAL",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      symbol: record.description
    };
  }

  private isBuyOrSellRecord(record: DeGiroRecord): boolean {

    if (!record) {
      return false;
    }

    const buySellRecordType = ["\@", "zu je"]//, "acquisto"];

    return buySellRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private isDividendRecord(record: DeGiroRecord): boolean {

    if (!record) {
      return false;
    }

    if (this.isTransactionFeeRecord(record)) {
      // dividend tax records often has 'Impôts sur dividende' or 'dividendbelasting'
      // which make them match the condition below.
      return false;
    }

    return record.description.toLocaleLowerCase().indexOf("dividend") > -1 || record.description.toLocaleLowerCase().indexOf("capital return") > -1;
  }

  private isTransactionFeeRecord(record: DeGiroRecord): boolean {

    if (!record) {
      return false;
    }

    const transactionFeeRecordType = ["en\/of", "and\/or", "und\/oder", "e\/o", "adr\/gdr", "ritenuta", "belasting", "daň z dividendy", "taxe sur les", "impôts sur", "comissões de transação", "courtage et/ou"];

    return transactionFeeRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private isPlatformFees(record: DeGiroRecord): boolean {

    const platformFeeRecordType = ["aansluitingskosten", "connection fee", "costi di connessione", "verbindungskosten", "custo de conectividade", "frais de connexion", "juros", "corporate action"];

    return platformFeeRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private isInterest(record: DeGiroRecord): boolean {

    const platformFeeRecordType = ["degiro courtesy"];

    return platformFeeRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private hashRecord(record: DeGiroRecord): string {
    const md5 = crypto.createHash('md5');
    md5.update(record.date);
    md5.update(record.time);
    md5.update(record.currencyDate.toString());
    md5.update(record.product);
    md5.update(record.isin);
    md5.update(record.description);
    md5.update(record.fx);
    md5.update(record.currency);
    md5.update(record.amount);
    md5.update(record.balance_currency);
    md5.update(record.balance);
    md5.update(record.orderId);
    return md5.digest('hex');
  }

  private formatFloat(val: number): number {
    return parseFloat(val.toFixed(3));
  }

  private getCurrencyIfConvertable(from_currency: string, to_currency: string): string {
      if (from_currency == "GBP" && (to_currency == "GBp" || to_currency == "GBX"))
          return to_currency

      if ((from_currency == "GBp" || from_currency == "GBX") && to_currency == "GBP")
          return to_currency;

      return from_currency;
  }

  private convertCurrencyIfConvertable(val: number, from_currency: string, to_currency: string): number {
      if (from_currency == "GBP" && (to_currency == "GBp" || to_currency == "GBX"))
          return val * 100.0;

      if (from_currency == "GBp" && to_currency == "GBP")
          return val / 100.0;

      return val;
  }
}
