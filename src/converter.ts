import path from "path";
import * as fs from "fs";
import dayjs from "dayjs";
import { SecurityService } from "./securityService";
import GhostfolioService from "./ghostfolioService";
import { AbstractConverter } from "./converters/abstractconverter";
import { AvanzaConverter } from "./converters/avanzaConverter";
import { BitvavoConverter } from "./converters/bitvavoConverter";
import { BuxConverter } from "./converters/buxConverter";
import { CoinbaseConverter } from "./converters/coinbaseConverter";
import { CointrackingConverter } from "./converters/cointrackingConverter";
import { DeGiroConverter } from "./converters/degiroConverter";
import { DeGiroConverterV2 } from "./converters/degiroConverterV2";
import { DeGiroConverterV3 } from "./converters/degiroConverterV3";
import { DeltaConverter } from "./converters/deltaConverter";
import { DirectaConverter } from "./converters/directaConverter";
import { EtoroConverter } from "./converters/etoroConverter";
import { FinpensionConverter } from "./converters/finpensionConverter";
import { FreetradeConverter } from "./converters/freetradeConverter";
import { GhostfolioExport } from "./models/ghostfolioExport";
import { IbkrConverter } from "./converters/ibkrConverter";
import { InvestimentalConverter } from "./converters/investimentalConverter";
import { ParqetConverter } from "./converters/parqetConverter";
import { RabobankConverter } from "./converters/rabobankConverter";
import { RevolutConverter } from "./converters/revolutConverter";
import { SaxoConverter } from "./converters/saxoConverter";
import { SchwabConverter } from "./converters/schwabConverter";
import { SwissquoteConverter } from "./converters/swissquoteConverter";
import { TradeRepublicConverter } from "./converters/tradeRepublicConverter";
import { Trading212Converter } from "./converters/trading212Converter";
import { XtbConverter } from "./converters/xtbConverter";

import packageInfo from "../package.json";

async function createAndRunConverter(converterType: string, inputFilePath: string, outputFilePath: string, completionCallback: CallableFunction, errorCallback: CallableFunction, securityService?: SecurityService) {

    // Verify if Ghostolio account ID is set (because without it there can be no valid output).
    if (!process.env.GHOSTFOLIO_ACCOUNT_ID) {
        return errorCallback(new Error("Environment variable GHOSTFOLIO_ACCOUNT_ID not set!"));
    }

    console.log(`[i] Starting Export to Ghostfolio v${packageInfo.version}`);

    // If DEBUG_LOGGING is enabled, set spaces to 2 else null for easier to read JSON output.
    const spaces = `${process.env.DEBUG_LOGGING}`.toLocaleLowerCase() === "true" ? 2 : null;

    const converterTypeLc = converterType.toLocaleLowerCase();

    // Determine convertor type.
    const converter = await createConverter(converterTypeLc, securityService);

    // Map the file to a Ghostfolio import.
    converter.readAndProcessFile(inputFilePath, async (result: GhostfolioExport) => {

        // Set cash balance update setting according to settings.
        result.updateCashBalance = `${process.env.GHOSTFOLIO_UPDATE_CASH}`.toLocaleLowerCase() === "true"

        // Check if the output needs to be split into chunks. If so, calculate how many files need to be produced.
        const splitOutput = `${process.env.GHOSTFOLIO_SPLIT_OUTPUT}`.toLocaleLowerCase() === "true";
        const filesToProduce = !splitOutput ? 1 : Math.round(result.activities.length / 25);

        console.log(`[i] Processing complete, writing to ${filesToProduce === 1 ? "file" : filesToProduce + " files"}..`);

        // Create a base result by copying everything but the activities.
        const baseResult: GhostfolioExport = {
            ...result,
            activities: []
        };

        for (let fix = 0; fix < filesToProduce; fix++) {

            // If only one file is to be produced, copy all activities.
            // Otherwise, slice the activities into chunks of 25.
            baseResult.activities = filesToProduce === 1
                ? result.activities
                : result.activities.slice(fix * 25, (fix + 1) * 25);

            // Write result to file.
            const outputFileName = path.join(outputFilePath, `ghostfolio-${converterTypeLc}${filesToProduce === 1 ? "" : "-" + (fix + 1)}-${dayjs().format("YYYYMMDDHHmmss")}.json`);
            const fileContents = JSON.stringify(baseResult, null, spaces);
            fs.writeFileSync(outputFileName, fileContents, { encoding: "utf-8" });

            console.log(`[i] Wrote data to '${outputFileName}'${filesToProduce === 1 ? "" : " (" + (fix + 1) + " of " + filesToProduce + ")"}`);

            await tryAutomaticValidationAndImport(outputFileName);
        }

        completionCallback();

    }, (error) => errorCallback(error));
}

async function createConverter(converterType: string, securityService?: SecurityService): Promise<AbstractConverter> {

    // If no security service is provided, create a new one.
    if (!securityService) {
        securityService = new SecurityService();
    }

    const cacheSize = await securityService.loadCache();
    console.log(`[i] Restored ${cacheSize[0]} ISIN-symbol pairs and ${cacheSize[1]} symbols from cache..`);

    let converter: AbstractConverter;

    switch (converterType) {

        case "avanza":
            console.log("[i] Processing file using Avanza converter");
            converter = new AvanzaConverter(securityService);
            break;
        case "bv":
        case "bitvavo":
            console.log("[i] Processing file using Bitvavo converter");
            converter = new BitvavoConverter(securityService);
            break;
        case "bux":
            console.log("[i] Processing file using Bux converter");
            converter = new BuxConverter(securityService);
            break;
        case "cb":
        case "coinbase":
            console.log("[i] Processing file using Coinbase converter");
            converter = new CoinbaseConverter(securityService);
            break;
        case "ct":
        case "cointracking":
            console.log("[i] Processing file using CoinTracking converter");
            converter = new CointrackingConverter(securityService);
            break;
        case "degiro-v1":
            console.log("[i] Processing file using DeGiro converter (V1)");
            console.log("[i] NOTE: This version of the DeGiro converter is deprecated and will no longer receive updates.");
            converter = new DeGiroConverter(securityService);
            break;
        case "degiro":
            console.log("[i] Processing file using DeGiro converter");
            console.log("[i] There is a new version of the DEGIRO converter available in public beta and we're looking for feedback!");
            console.log("[i] You can enable the new converter by setting the environment variable DEGIRO_FORCE_V3=true");
            converter = new DeGiroConverterV2(securityService);
            break;
        case "degiro-v3":
            console.log("[i] Processing file using DeGiro converter V3");
            console.log("[i] NOTICE: This converter is currently in public beta and may not be complete!");
            console.log("[i] Should you have issues with the result of the converter, please report a bug at https://git.new/degiro-v3-bug");
            converter = new DeGiroConverterV3(securityService);
            break;
        case "delta":
            console.log("[i] Processing file using Delta converter");
            converter = new DeltaConverter(securityService);
            break;
        case "directa":
            console.log("[i] Processing file using Directa converter, this is an experimental converter!");
            converter = new DirectaConverter(securityService);
            break;
        case "etoro":
            console.log("[i] Processing file using Etoro converter");
            converter = new EtoroConverter(securityService);
            break;
        case "fp":
        case "finpension":
            console.log("[i] Processing file using Finpension converter");
            converter = new FinpensionConverter(securityService);
            break;
        case "ft":
        case "freetrade":
            console.log("[i] Processing file using Freetrade converter");
            converter = new FreetradeConverter(securityService);
            break;
        case "ibkr":
            console.log("[i] Processing file using IBKR converter");
            converter = new IbkrConverter(securityService);
            break;
        case "investimental":
            console.log("[i] Processing file using Investimental converter");
            converter = new InvestimentalConverter(securityService);
            break;
        case "parqet":
            console.log("[i] Processing file using Parqet converter");
            converter = new ParqetConverter(securityService);
            break;
        case "rabobank":
            console.log("[i] Processing file using Rabobank converter");
            converter = new RabobankConverter(securityService);
            break;
        case "revolut":
            console.log("[i] Processing file using Revolut converter");
            converter = new RevolutConverter(securityService);
            break;
        case "saxo":
            console.log("[i] Processing file using Saxo converter");
            converter = new SaxoConverter(securityService);
            break;
        case "schwab":
            console.log("[i] Processing file using Schwab converter");
            converter = new SchwabConverter(securityService);
            break;
        case "sq":
        case "swissquote":
            console.log("[i] Processing file using Swissquote converter");
            converter = new SwissquoteConverter(securityService);
            break;
        case "tr":
        case "traderepublic":
            console.log("[i] Processing file using TradeRepublic converter");
            converter = new TradeRepublicConverter(securityService);
            break;
        case "t212":
        case "trading212":
            console.log("[i] Processing file using Trading212 converter");
            converter = new Trading212Converter(securityService);
            break;
        case "xtb":
            console.log("[i] Processing file using XTB converter");
            converter = new XtbConverter(securityService);
            break;
        default:
            throw new Error(`Unknown converter '${converterType}' provided`);
    }

    return converter;
}

async function tryAutomaticValidationAndImport(outputFileName: string) {

    try {
        let ghostfolioService;

        // When automatic validation is enabled, do this.
        if (`${process.env.GHOSTFOLIO_VALIDATE}` === "true") {

            ghostfolioService = new GhostfolioService();

            console.log('[i] Automatic validation is allowed. Start validating..');
            const validationResult = await ghostfolioService.validate(outputFileName);
            console.log(`[i] Finished validation. ${validationResult ? 'Export was valid!' : 'Export was not valid!'}`);
        }
        else {
            console.log('[i] You can now automatically validate the generated file against Ghostfolio. Set GHOSTFOLIO_VALIDATE=true in your environment variables to enable this feature.');
        }

        // When automatic import is enabled, do this.
        if (`${process.env.GHOSTFOLIO_IMPORT}` === "true") {

            ghostfolioService = ghostfolioService ?? new GhostfolioService();

            console.log('[i] Automatic import is allowed. Start importing..');
            console.log('[i] THIS IS AN EXPERIMENTAL FEATURE!! Use this at your own risk!');
            const importResult = await ghostfolioService.import(outputFileName);
            console.log(`[i] Finished importing. ${importResult > 0 ? `Succesfully imported ${importResult} activities!` : 'Import failed!'}`);
        }
        else {
            console.log('[i] You can now automatically import the generated file into Ghostfolio. Set GHOSTFOLIO_IMPORT=true in your environment variables to enable this feature');
            console.log('[i] THIS IS AN EXPERIMENTAL FEATURE!! Use this at your own risk!');
        }
    }
    catch (e) {
        console.log(`[e] Did not complete automatic import & validation due to errors: ${e}`);
    }
}

export {
    createAndRunConverter,
    createConverter
}
