import path from "path";
import * as fs from "fs";
import chokidar from "chokidar";
import * as cacache from "cacache";
import * as matcher from "closest-match";
import { createAndRunConverter } from "./converter";

// Check if the cache should be purged.
if (Boolean(process.env.PURGE_CACHE)) {

    console.log("[i] Purging cache (PURGE_CACHE set to true)..");
    Promise.all([
        cacache.rm("/var/tmp/e2g-cache", "isinSymbolCache"),
        cacache.rm("/var/tmp/e2g-cache", "symbolCache")
    ]).then(() => console.log("[i] Cache purged!"));
}

// Define input and output.
const inputFolder = process.env.E2G_INPUT_FOLDER || "/var/tmp/e2g-input";
const outputFolder = process.env.E2G_OUTPUT_FOLDER || "/var/tmp/e2g-output";
const usePolling = Boolean(process.env.USE_POLLING) || false;

console.log(`[i] Watching ${inputFolder}${usePolling ? " (using polling)" : ""}..`);

let isProcessing = false;

chokidar
    .watch(inputFolder, { usePolling: usePolling })
    .on("add", filePath => {

        isProcessing = true;

        console.log(`[i] Found ${path.basename(filePath)}!`);

        const fileContents = fs.readFileSync(filePath, "utf-8");

        const closestMatch = matcher.closestMatch(fileContents.split("\n")[0], [...headers.keys()]);

        let converterKey = closestMatch as string;

        // If multiple matches were found (type would not be 'string'), pick the first.
        if (typeof closestMatch !== "string") {
            converterKey = closestMatch[0];
        }

        let converter = headers.get(converterKey);

        // Temporary flag to force DEGIRO V3.
        if (converter === "degiro" && `${process.env.DEGIRO_FORCE_V3}` === "true") {
            console.log("[i] Using DEGIRO V3 Beta converter because DEGIRO_FORCE_V3 was set to true..");
            converter = "degiro-v3";
        }

        console.log(`[i] Determined the file type to be of kind '${converter}'.`);

        // Determine convertor type and run conversion.
        createAndRunConverter(converter, filePath, outputFolder,
            () => {

                // After conversion was succesful, remove input file.
                console.log(`[i] Finished converting ${path.basename(filePath)}, removing file..`);
                fs.rmSync(filePath);

                isProcessing = false;

                if (!usePolling) {
                    console.log("[i] Stop container as usePolling is set to false..");
                    process.exit(0);
                }

            }, (err) => {

                console.log("[e] An error ocurred while processing.");
                console.log(`[e] ${err}`);

                // Move file with errors to output folder so it can be fixed manually.
                console.log("[e] Moving file to output..");
                const errorFilePath = path.join(outputFolder, path.basename(filePath));
                fs.copyFileSync(filePath, errorFilePath);
                fs.rmSync(filePath);

                isProcessing = false;

                if (!usePolling) {
                    console.log("[i] Stop container as usePolling is set to false..");
                    process.exit(0);
                }
            });
    })
    .on("ready", () => {

        // When polling was not set to true (thus runOnce) and there is no file currently being processed, stop the container.
        setTimeout(() => {
            if (!usePolling && !isProcessing) {
                console.log("[i] Found no file to convert, stop container as usePolling is set to false..");
                process.exit(0);
            }
        }, 5000);
    });

// Prep header set.
const headers: Map<string, string> = new Map<string, string>();
headers.set(`Datum;Konto;Typ av transaktion;Värdepapper/beskrivning;Antal;Kurs;Belopp;Transaktionsvaluta;Courtage (SEK);Valutakurs;Instrumentvaluta;ISIN;Resultat`, "avanza");
headers.set(`Timezone,Date,Time,Type,Currency,Amount,Quote Currency,Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,Transaction ID,Address`, "bitvavo");
headers.set(`Transaction Time (CET),Transaction Category,Transaction Type,Asset Id,Asset Name,Asset Currency,Transaction Currency,Currency Pair,Exchange Rate,Transaction Amount,Trade Amount,Trade Price,Trade Quantity,Cash Balance Amount,Profit And Loss Amount,Profit And Loss Currency`, "bux");
headers.set(`ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes`, "coinbase");
headers.set(`"Type","Buy","Cur.","Sell","Cur.","Fee","Cur.","Exchange","Group","Comment","Date","Tx-ID"`, "cointracking");
headers.set(`Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id`, "degiro");
headers.set(`Date,Way,Base amount,Base currency (name),Base type,Quote amount,Quote currency,Exchange,Sent/Received from,Sent to,Fee amount,Fee currency (name),Broker,Notes`, "delta");
headers.set(`Data operazione,Data valuta,Tipo operazione,Ticker,Isin,Protocollo,Descrizione,Quantità,Importo euro,Importo Divisa,Divisa,Riferimento ordine`, "directa");
headers.set(`Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA`, "etoro");
headers.set(`Date;Category;"Asset Name";ISIN;"Number of Shares";"Asset Currency";"Currency Rate";"Asset Price in CHF";"Cash Flow";Balance`, "finpension");
headers.set(`Title,Type,Timestamp,Account Currency,Total Amount,Buy / Sell,Ticker,ISIN,Price per Share in Account Currency,Stamp Duty,Quantity,Venue,Order ID,Order Type,Instrument Currency,Total Shares Amount,Price per Share,FX Rate,Base FX Rate,FX Fee (BPS),FX Fee Amount,Dividend Ex Date,Dividend Pay Date,Dividend Eligible Quantity,Dividend Amount Per Share,Dividend Gross Distribution Amount,Dividend Net Distribution Amount,Dividend Withheld Tax Percentage,Dividend Withheld Tax Amount`, "freetrade");
headers.set(`"Buy/Sell","TradeDate","ISIN","Quantity","TradePrice","TradeMoney","CurrencyPrimary","IBCommission","IBCommissionCurrency"`, "ibkr");
headers.set(`"Type","SettleDate","ISIN","Description","Amount","CurrencyPrimary"`, "ibkr");
headers.set(`Trades Date,Exchange,Symbol,Side,Trades Count,Average Price,Total Volume,Total Value,Total Fees,Account ID,Account Name`, "investimental");
headers.set(`"datetime";"date";"time";"price";"shares";"amount";"tax";"fee";"realizedgains";"type";"broker";"assettype";"identifier";"wkn";"originalcurrency";"currency";"fxrate";"holding";"holdingname";"holdingnickname";"exchange";"avgholdingperiod"`, "parqet");
headers.set(`Portefeuille;Naam;Datum;Type mutatie;Valuta mutatie;Volume;Koers;Valuta koers;Valuta kosten €;Waarde;Bedrag;Isin code;Tijd;Beurs`, "rabobank");
headers.set(`Symbol,Type,Quantity,Price,Value,Fees,Date`, "revolut");
headers.set(`Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate`, "revolut");
headers.set(`Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate`, "saxo");
headers.set(`Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount`, "schwab");
headers.set(`Date;Order #;Transaction;Symbol;Name;ISIN;Quantity;Unit price;Costs;Accrued Interest;Net Amount;Balance;Currency`, "swissquote");
headers.set(`Datum;Transactietype;Waarde (netto);Opmerking;ISIN;Aantal;Kosten;Belasting`, "tradeRepublic");
headers.set(`Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee`, "trading212");
headers.set(`ID;Type;Time;Symbol;Comment;Amount`, "xtb");
