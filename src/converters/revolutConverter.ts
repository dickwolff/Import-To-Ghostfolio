import dayjs from "dayjs";
import { parse } from "csv-parse";
import { RevolutRecord } from "../models/revolutRecord";
import { AbstractConverter } from "./abstractconverter";
import { SecurityService } from "../securityService";
import { GhostfolioExport } from "../models/ghostfolioExport";
import YahooFinanceRecord from "../models/yahooFinanceRecord";
import { GhostfolioOrderType } from "../models/ghostfolioOrderType";

export class RevolutConverter extends AbstractConverter {

    constructor(securityService: SecurityService) {
        super(securityService);
    }

    /**
     * @inheritdoc
     */
    public processFileContents(input: string, successCallback: any, errorCallback: any): void {

        if (input.split("\n")[0].split(",").length === 7) {
            return this.processCryptoFileContents(input, successCallback, errorCallback);
        }

        return this.processInvestFileContents(input, successCallback, errorCallback);
    }

    /**
     * @inheritdoc
     */
    public isIgnoredRecord(record: RevolutRecord): boolean {
        let ignoredRecordTypes = ["transfer from", "withdrawal", "top-up", "stake", "send", "receive"];

        return ignoredRecordTypes.some(t => record.type.toLocaleLowerCase().indexOf(t) > -1)
    }

    private processInvestFileContents(input: string, successCallback: any, errorCallback: any): void {

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

                // Convert actions to Ghostfolio type.
                if (context.column === "type") {
                    const action = columnValue.toLocaleLowerCase();

                    if (action.indexOf("buy") > -1 || action.indexOf("stock split") > -1) {
                        return "buy";
                    }
                    else if (action.indexOf("sell") > -1) {
                        return "sell";
                    }
                    else if (action.indexOf("dividend") > -1) {
                        return "dividend";
                    }
                    else if (action.indexOf("fee") > -1) {
                        return "fee";
                    }
                }

                // Parse numbers to floats (from string).
                if (context.column === "quantity" ||
                    context.column === "pricePerShare" ||
                    context.column === "totalAmount") {
                    if (columnValue === "") {
                        return 0;
                    }

                    return parseFloat(columnValue.replace(/[$]/g, '').trim());
                }

                return columnValue;
            }
        }, async (err, records: RevolutRecord[]) => await this.processRevolutFile(err, records, successCallback, errorCallback));
    }

    private processCryptoFileContents(input: string, successCallback: any, errorCallback: any): void {

        // Parse the CSV and convert to Ghostfolio import format.
        parse(input, {
            delimiter: ",",
            fromLine: 2,
            columns: this.processHeaders(input),
            on_record: (record) => {

                // Custom mapping below.

                const recordType = record.type.toLocaleLowerCase();
                record.type = recordType === "buy" ? "buy" : recordType === "sell" ? "sell" : "dividend";

                record.currency = this.detectCurrency(record.price);

                const priceAmount = record.price.match(/([\d.,]+)/g) ?? ["0"];
                record.price = record.price !== "" ? parseFloat(priceAmount[0].replace(",", "")) : 0;

                const valueAmount = record.value.match(/([\d.,]+)/g);
                record.value = record.value !== "" ? parseFloat(valueAmount[0].replace(",", "")) : 0;

                const feesAmount = record.fees.match(/([\d.,]+)/g);
                record.fees = record.fees !== "" ? parseFloat(feesAmount[0].replace(",", "")) : 0;

                record.quantity = parseFloat(record.quantity);

                return record;
            }
        }, async (err, records: RevolutRecord[]) => await this.processRevolutFile(err, records, successCallback, errorCallback));
    }

    private async processRevolutFile(err, records: RevolutRecord[], successCallback: any, errorCallback: any) {

        // Check if parsing failed..
        if (err || records === undefined || records.length === 0) {
            let errorMsg = "An error ocurred while parsing!";

            if (err) {
                errorMsg += ` Details: ${err.message}`
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
        }

        // Populate the progress bar.
        const bar1 = this.progress.create(records.length, 0);

        for (let idx = 0; idx < records.length; idx++) {
            const record = records[idx];

            // Check if the record should be ignored.
            if (this.isIgnoredRecord(record)) {
                bar1.increment();
                continue;
            }

            // Fees do not have a security, so add those immediately.
            if (record.type.toLocaleLowerCase() === "fee") {

                const feeAmount = Math.abs(record.totalAmount);

                // Add record to export.
                result.activities.push({
                    accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
                    comment: `Revolut ${record.type.toLocaleLowerCase()}`,
                    fee: feeAmount,
                    quantity: 1,
                    type: GhostfolioOrderType[record.type],
                    unitPrice: 0,
                    currency: record.currency,
                    dataSource: "MANUAL",
                    date: dayjs(record.date).format("YYYY-MM-DDTHH:mm:ssZ"),
                    symbol: `Revolut ${record.type.toLocaleLowerCase()}`
                });

                bar1.increment();
                continue;
            }

            let security: YahooFinanceRecord;
            try {
                security = await this.securityService.getSecurity(
                    null,
                    record.ticker ?? `${record.symbol}-${record.currency}`,
                    null,
                    record.currency,
                    this.progress);
            }
            catch (err) {
                this.logQueryError(record.ticker, idx + 2);
                return errorCallback(err);
            }

            // Log whenever there was no match found.
            if (!security) {
                this.progress.log(`[i] No result found for ${record.type} action for ${record.ticker ?? record.symbol} with currency ${record.currency}! Please add this manually..\n`);
                bar1.increment();
                continue;
            }

            let quantity, unitPrice;

            if (record.type === "dividend") {
                quantity = record.quantity ?? 1;
                unitPrice = Math.abs(record.totalAmount ?? 1);
            } else {
                quantity = record.quantity;
                unitPrice = record.pricePerShare ?? record.price;
            }

            // Add record to export.
            result.activities.push({
                accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
                comment: "",
                fee: 0,
                quantity: quantity,
                type: GhostfolioOrderType[record.type],
                unitPrice: unitPrice,
                currency: record.currency,
                dataSource: "YAHOO",
                date: dayjs(record.date).format("YYYY-MM-DDTHH:mm:ssZ"),
                symbol: security.symbol
            });

            bar1.increment();
        }

        this.progress.stop()

        successCallback(result);
    }

    private detectCurrency(value: string) {

        // Remove all the numbers from the string, so we can detect the currency.
        const currency = value.replace(/([\d.,]+)/g, "").trim();

        switch (currency.toLocaleUpperCase()) {
            case "€":
                return "EUR";
            case "$":
                return "USD";
            case "£":
                return "GBP";
            case "SEK":
                return "SEK";
            default:
                return "EUR";
        }
    }
}