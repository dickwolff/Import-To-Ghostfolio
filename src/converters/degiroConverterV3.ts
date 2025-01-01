import dayjs from "dayjs";
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

    // Fix broken lines with ,,,,,,, that seems to be a export bug from DEGIRO.
    input = input.replace(/\n,,,,,,,,,,,/gm, "");

    // Parse the CSV and convert to Ghostfolio import format.
    parse(input, {
      delimiter: ",",
      fromLine: 2,
      columns: this.processHeaders(input),
      cast: (columnValue, _) => {

        // Custom mapping below.

        return columnValue;
      }
    }, async (err, records: DeGiroRecord[]) => {

      // Check if parsing failed..
      if (err || records === undefined || records.length === 0) {
        let errorMsg = "An error ocurred while parsing!";

        if (err) {
          errorMsg += ` Details: ${err.message}`

          // Temporary error check for Transactions.csv
          if (err.message.indexOf("length is 12, got 19")) {
            console.error("[i] Detecting wrong input format. Have you exported the correct CSV file?");
            console.error("[i] Export to Ghostfolio only supports Account.csv, not Transactions.csv!");
            console.error("[i] See the export instructions in the README at https://git.new/JjA86vv");
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

      // Populate the progress bar.
      const bar1 = this.progress.create(records.length, 0);

      for (let idx = 0; idx < records.length; idx++) {
        const record = records[idx];

        // Check if the record should be ignored. 
        if (this.isIgnoredRecord(record)) {
          bar1.increment();
          continue;
        }

        // Look if the current record was already processed previously by checking the orderId.
        // Dividend records don't have an order ID, so check for a marking there.
        // If a match was found, skip the record and move next.
        if (result.activities.findIndex(a => a.comment !== "" && a.comment === record.orderId || a.comment.startsWith("Dividend") && a.comment.endsWith(`${record.date}T${record.time}`)) > -1) {
          bar1.increment();
          continue;
        }

        // TODO: Is is possible to add currency? So VWRL.AS is retrieved for IE00B3RBWM25 instead of VWRL.L.
        // Maybe add yahoo-finance2 library that Ghostfolio uses, so I dont need to call Ghostfolio for this.

        // Platform fees do not have a security, add those immediately.
        if (this.isPlatformFees(record)) {

          const feeAmount = Math.abs(parseFloat(record.amount.replace(",", ".")));
          const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");

          result.activities.push({
            accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
            comment: "",
            fee: feeAmount,
            quantity: 1,
            type: GhostfolioOrderType.fee,
            unitPrice: feeAmount,
            currency: record.currency,
            dataSource: "MANUAL",
            date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
            symbol: record.description
          });

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

        // Look ahead in the remaining records if there is one with the samen orderId.
        const matchByOrderId = this.findMatchByOrderId(record, records.slice(idx + 1));

        // If it's a standalone record, add it immediately.
        if (!matchByOrderId) {
          result.activities.push(this.mapRecordToActivity(record, security));
        }
        else {

          // This is a pair of records. Check which type of record it is and then combine the records into a Ghostfolio activity.

          // Check wether it is a buy/sell record set.
          if (this.isBuyOrSellRecordSet(record, matchByOrderId)) {
            result.activities.push(this.combineRecords(record, matchByOrderId, security));
          } else {
            result.activities.push(this.mapDividendRecord(record, matchByOrderId, security));
          }
        }

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
      "col1", // Not relevant column.
      "col2", // Not relevant column.
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

    const ignoredRecordTypes = [
      "ideal",
      "flatex",
      "cash sweep",
      "withdrawal",
      "productwijziging",
      "währungswechsel",
      "trasferisci",
      "deposito",
      "credito",
      "prelievo",
      "creditering",
      "debitering",
      "rente",
      "interesse",
      "verrekening promotie",
      "operation de change",
      "versement de fonds",
      "débit",
      "depósito",
      "ingreso",
      "retirada",
      "levantamento de divisa",
      "dito de divisa"];

    return ignoredRecordTypes.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private findMatchByOrderId(currentRecord: DeGiroRecord, records: DeGiroRecord[]): DeGiroRecord | undefined {
    return records.find(r => r.orderId === currentRecord.orderId);
  }

  private mapRecordToActivity(record: DeGiroRecord, security?: YahooFinanceRecord, isTransactionFeeRecord: boolean = false): GhostfolioActivity {

    let numberShares, unitPrice, feeAmount = 0;
    let orderType;

    // If it is not a transaction fee record, get data from the record.
    if (!isTransactionFeeRecord) {

      try {
        // Get the amount of shares from the description.
        const numberSharesFromDescription = record.description.match(/([\d*\.?\,?\d*]+)/)[0];
        numberShares = parseFloat(numberSharesFromDescription);
      } catch (error) {
        console.error(`Could not parse the number of shares from the description: ${record.description}`, error, record);
        throw new Error(`Could not parse the number of shares from the description: ${record.description}`);    
      }

      // For buy/sale records, only the total amount is recorded. So the unit price needs to be calculated.
      const totalAmount = parseFloat(record.amount.replace(",", "."));
      unitPrice = parseFloat((Math.abs(totalAmount) / numberShares).toFixed(3));

      // If amount is negative, so money has been removed, thus it's a buy record.      
      if (totalAmount < 0) {
        orderType = GhostfolioOrderType.buy;
      } else {
        orderType = GhostfolioOrderType.sell;
      }
    }
    else {

      // Otherwise, get the transaction fee info.
      feeAmount = parseFloat(Math.abs(parseFloat(record.amount.replace(",", "."))).toFixed(3));
    }

    const date = dayjs(`${record.date} ${record.time}:00`, "DD-MM-YYYY HH:mm");

    // Create the record.
    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: record.orderId,
      fee: feeAmount,
      quantity: numberShares,
      type: orderType,
      unitPrice: unitPrice,
      currency: security.currency ?? record.currency ?? "",
      dataSource: "YAHOO",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      symbol: security.symbol ?? "",
    };
  }

  private combineRecords(currentRecord: DeGiroRecord, nextRecord: DeGiroRecord, security: YahooFinanceRecord): GhostfolioActivity {

    // Set the default values for the records.
    let actionRecord = currentRecord;
    let txFeeRecord: DeGiroRecord | null = nextRecord;

    // Determine which of the two records is the action record (e.g. buy/sell) and which contains the transaction fees.
    // Firstly, check if the current record is the TxFee record.
    if (this.isTransactionFeeRecord(currentRecord, true)) {
      actionRecord = nextRecord;
      txFeeRecord = currentRecord;
    }

    // Map both records.
    const mappedActionRecord = this.mapRecordToActivity(actionRecord, security);
    const mappedTxFeeRecord = this.mapRecordToActivity(txFeeRecord, security, true);

    // Extract the fee from the transaction fee record and put it in the action record.
    mappedActionRecord.fee = mappedTxFeeRecord.fee;

    return mappedActionRecord;
  }

  private mapDividendRecord(currentRecord: DeGiroRecord, nextRecord: DeGiroRecord | null = null, security: YahooFinanceRecord): GhostfolioActivity {

    // It's a dividend set.
    // Set the default values for the records.
    let dividendRecord = currentRecord;
    let txFeeRecord: DeGiroRecord = nextRecord;

    // Determine which of the two records is the dividend record and which contains the transaction fees.
    // Firstly, check if the current record is the TxFee record.
    if (nextRecord && this.isTransactionFeeRecord(currentRecord, false)) {
      dividendRecord = nextRecord;
      txFeeRecord = currentRecord;
    }

    let unitPrice = Math.abs(parseFloat(dividendRecord.amount.replace(",", ".")));
    let fees = 0;
    if (txFeeRecord) {
      fees = Math.abs(parseFloat(txFeeRecord.amount.replace(",", ".")));
    }

    const date = dayjs(`${dividendRecord.date} ${dividendRecord.time}:00`, "DD-MM-YYYY HH:mm");

    // Create the record.
    return {
      accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
      comment: `Dividend ${currentRecord.date}T${currentRecord.time}`,
      fee: fees,
      quantity: 1,
      type: GhostfolioOrderType.dividend,
      unitPrice: unitPrice,
      currency: security.currency ?? dividendRecord.currency,
      dataSource: "YAHOO",
      date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
      symbol: security.symbol,
    };
  }

  private isBuyOrSellRecordSet(currentRecord: DeGiroRecord, nextRecord: DeGiroRecord): boolean {
    return (this.isBuyOrSellRecord(currentRecord) && this.isTransactionFeeRecord(nextRecord, true)) ||
      (this.isTransactionFeeRecord(currentRecord, true) && this.isBuyOrSellRecord(nextRecord))
  }

  private isBuyOrSellRecord(record: DeGiroRecord): boolean {

    if (!record) {
      return false;
    }

    const buySellRecordType = ["\@", "zu je"]//, "acquisto"];

    return buySellRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private isTransactionFeeRecord(record: DeGiroRecord, isBuyOrSellTransactionFeeRecord: boolean): boolean {

    if (!record) {
      return false;
    }

    // When a dividend transaction must be found, there should not be an orderid.
    if (!isBuyOrSellTransactionFeeRecord && record.orderId) {
      return false;
    }

    const transactionFeeRecordType = ["en\/of", "and\/or", "und\/oder", "e\/o", "adr\/gdr", "ritenuta", "belasting", "daň z dividendy", "taxe sur les", "impôts sur", "comissões de transação", "courtage et/ou", "costes de transacción"];

    return transactionFeeRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }

  private isPlatformFees(record: DeGiroRecord): boolean {

    const platformFeeRecordType = ["aansluitingskosten", "costi di connessione", "verbindungskosten", "custo de conectividade", "frais de connexion", "juros", "corporate action", "comisión de conectividad"];

    return platformFeeRecordType.some((t) => record.description.toLocaleLowerCase().indexOf(t) > -1);
  }
}
