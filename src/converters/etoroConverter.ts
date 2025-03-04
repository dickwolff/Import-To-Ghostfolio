import dayjs from "dayjs";
import { parse } from "csv-parse";
import { EtoroRecord } from "../models/etoroRecord";
import { AbstractConverter } from "./abstractconverter";
import { SecurityService } from "../securityService";
import { GhostfolioExport } from "../models/ghostfolioExport";
import YahooFinanceRecord from "../models/yahooFinanceRecord";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { GhostfolioOrderType } from "../models/ghostfolioOrderType";

export class EtoroConverter extends AbstractConverter {

    constructor(securityService: SecurityService) {
        super(securityService);

        dayjs.extend(customParseFormat);
    }

    /**
     * @inheritdoc
     */
    public processFileContents(input: string, successCallback: any, errorCallback: any): void {

        // Parse the CSV and convert to Ghostfolio import format.
        parse(input, {
            delimiter: ",",
            fromLine: 2,
            columns: this.processHeaders(input),
            cast: (columnValue, context) => {

                // Custom mapping below.

                // Convert actions to Ghostfolio type.
                if (context.column === "type") {
                    const action = columnValue.toLocaleLowerCase();

                    if (action.indexOf("open position") > -1) {
                        return "buy";
                    }
                    else if (action.indexOf("position closed") > -1) {
                        return "sell";
                    }
                    else if (action.indexOf("dividend") > -1) {
                        return "dividend";
                    }
                    else if (action.indexOf("interest") > -1) {
                        return "interest";
                    }
                    else if (action.indexOf("fee") > -1) {
                        return "fee";
                    }
                    else if (action.indexOf("refund") > -1) {
                        return "refund";
                    }
                }

                // Parse numbers to floats (from string).
                if (context.column === "amount" ||
                    context.column === "units") {

                    if (context.column === "units" && columnValue === "-") {
                        return 1;
                    }

                    return parseFloat(columnValue.replace(/[()]/g, '').replace(',', '.'));
                }

                return columnValue;
            }
        }, async (err, records: EtoroRecord[]) => {

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

                const date = dayjs(`${record.date}`, "DD/MM/YYYY HH:mm:ss");

                // Interest, fee and refund does not have a security, so add those immediately.
                if (record.type.toLocaleLowerCase() === "interest" || record.type.toLocaleLowerCase() === "fee" || record.type.toLocaleLowerCase() === "refund") {

                    const feeAmount = Math.abs(record.amount);
                    let recordType = record.type
                    let comment = '';

                    if (record.type.toLocaleLowerCase() === "fee" || record.type.toLocaleLowerCase() === "refund") {
                        comment += `${recordType.toLocaleUpperCase()} ${record.assetType} ${record.details}`;
                    }

                    if (recordType.toLocaleLowerCase() === "refund") {
                        recordType = "interest";
                    }

                    // Add fees record to export.
                    result.activities.push({
                        accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
                        comment: comment,
                        fee: feeAmount,
                        quantity: 1,
                        type: GhostfolioOrderType[recordType],
                        unitPrice: feeAmount,
                        currency: "USD",
                        dataSource: "MANUAL",
                        date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
                        symbol: ""
                    });

                    bar1.increment();
                    continue;
                }

                const detailsSplit = record.details.split("/");
                const symbol = detailsSplit[0];
                let currency = detailsSplit[1];
                currency = currency === "GBX" ? "GBp" : currency;

                let security: YahooFinanceRecord;
                try {
                    security = await this.securityService.getSecurity(
                        null,
                        symbol,
                        null,
                        currency,
                        this.progress);
                }
                catch (err) {
                    this.logQueryError(record.details, idx + 2);
                    return errorCallback(err);
                }

                // Log whenever there was no match found.
                if (!security) {
                    this.progress.log(`[i] No result found for ${record.type} action for ${record.details}! Please add this manually..\n`);
                    bar1.increment();
                    continue;
                }

                const unitPrice = parseFloat((record.amount / record.units).toFixed(6));

                // Add record to export.
                result.activities.push({
                    accountId: process.env.GHOSTFOLIO_ACCOUNT_ID,
                    comment: "",
                    fee: 0,
                    quantity: record.units,
                    type: GhostfolioOrderType[record.type],
                    unitPrice: unitPrice,
                    currency: currency,
                    dataSource: "YAHOO",
                    date: date.format("YYYY-MM-DDTHH:mm:ssZ"),
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
    protected processHeaders(_: string): string[] {

        // Generic header mapping from the Etoro CSV export.
        const csvHeaders = [
            "date",
            "type",
            "details",
            "amount",
            "units",
            "realizedEquityChange",
            "realizedEquity",
            "balance:",
            "positionId",
            "assetType",
            "nwa"];

        return csvHeaders;
    }

    /**
     * @inheritdoc
     */
    public isIgnoredRecord(record: EtoroRecord): boolean {
        let ignoredRecordTypes = ["deposit", "withdraw", "conversion"];

        return ignoredRecordTypes.some(t => record.type.toLocaleLowerCase().indexOf(t) > -1)
    }
}
