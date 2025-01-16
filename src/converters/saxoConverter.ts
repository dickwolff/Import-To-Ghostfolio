import dayjs from "dayjs";
import { parse } from "csv-parse";
import { AbstractConverter } from "./abstractconverter";
import { SecurityService } from "../securityService";
import { GhostfolioExport } from "../models/ghostfolioExport";
import { SaxoRecord } from "../models/saxoRecord";
import YahooFinanceRecord from "../models/yahooFinanceRecord";
import { GhostfolioOrderType } from "../models/ghostfolioOrderType";

export class SaxoConverter extends AbstractConverter {

    constructor(securityService: SecurityService) {
        super(securityService);
    }

    /**
     * @inheritdoc
     */
    public processFileContents(input: string, successCallback: any, errorCallback: any): void {

        // Parse the CSV and convert to Ghostfolio import format.
        parse(input, {
            delimiter: ",",
            fromLine: 2,
            columns: this.processHeaders(input, ","),
            cast: (columnValue, context) => {

                // Custom mapping below.

                if (context.column === "instrumentCurrency" && columnValue === "GBX") {
                    return "GBp";
                }

                // Parse numbers to floats (from string).
                if (context.column === "amount" || context.column === "conversionRate") {
                    return parseFloat(columnValue);
                }

                return columnValue;
            }
        }, async (err, records: SaxoRecord[]) => {

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
                if (record.event.toLocaleLowerCase().indexOf("fee") > -1) {

                    const feeAmount = Math.abs(record.amount);

                    // Add fees record to export.
                    result.activities.push({
                        accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
                        comment: "",
                        fee: feeAmount,
                        quantity: 1,
                        type: GhostfolioOrderType.fee,
                        unitPrice: 0,
                        currency: record.instrumentCurrency,
                        dataSource: "MANUAL",
                        date: dayjs(record.tradeDate).format("YYYY-MM-DDTHH:mm:ssZ"),
                        symbol: record.event
                    });

                    bar1.increment();
                    continue;
                }

                let security: YahooFinanceRecord;
                try {
                    security = await this.securityService.getSecurity(
                        record.instrumentIsin,
                        record.instrumentSymbol.split(":")[0],
                        record.instrument,
                        record.instrumentCurrency,
                        this.progress);
                }
                catch (err) {
                    this.logQueryError(record.instrumentIsin || record.instrumentSymbol || record.instrument, idx + 2);
                    return errorCallback(err);
                }

                const action = record.amount < 0 ? "buy" : "sell";

                // Todo: dividend

                // Log whenever there was no match found.
                if (!security) {
                    this.progress.log(`[i] No result found for ${action} action for ${record.instrumentIsin || record.instrumentSymbol.split(":")[0] || record.instrument} with currency ${record.instrumentCurrency}! Please add this manually..\n`);
                    bar1.increment();
                    continue;
                }

                //record.event = "Buy 3 @ 134.85 USD"
                const actionDetails = record.event.match(/(\d+)\s+@\s+([\d.]+)/)

                // Make negative numbers (on sell records) absolute.
                let numberOfShares = parseFloat(actionDetails[1]);
                let assetPrice = parseFloat(actionDetails[2]);

                // Add record to export.
                result.activities.push({
                    accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
                    comment: "",
                    fee: 0,
                    quantity: numberOfShares,
                    type: GhostfolioOrderType[action],
                    unitPrice: assetPrice,
                    currency: record.instrumentCurrency,
                    dataSource: "YAHOO",
                    date: dayjs(record.tradeDate).format("YYYY-MM-DDTHH:mm:ssZ"),
                    symbol: security.symbol
                });

                bar1.increment();
            }

            this.progress.stop()

            successCallback(result);
        });
    }

    /**
     * @inheritdoc
     */
    public isIgnoredRecord(record: SaxoRecord): boolean {
        let ignoredRecordTypes = ["deposit", "withdrawal"];

        return ignoredRecordTypes.some(t => record.event.toLocaleLowerCase().indexOf(t) > -1)
    }
}
