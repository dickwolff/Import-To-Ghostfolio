import { SaxoConverter } from "./saxoConverter";
import { SecurityService } from "../securityService";
import { GhostfolioExport } from "../models/ghostfolioExport";
import YahooFinanceServiceMock from "../testing/yahooFinanceServiceMock";

describe("saxoConverter", () => {

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should construct", () => {

    // Act
    const sut = new SaxoConverter(new SecurityService(new YahooFinanceServiceMock()));

    // Assert
    expect(sut).toBeTruthy();
  });

  it("should process sample CSV file", (done) => {

    // Arange
    const sut = new SaxoConverter(new SecurityService(new YahooFinanceServiceMock()));
    const inputFile = "samples/saxo-export.csv";

    // Act
    sut.readAndProcessFile(inputFile, (actualExport: GhostfolioExport) => {

      // Assert
      expect(actualExport).toBeTruthy();
      expect(actualExport.activities.length).toBeGreaterThan(0);
      expect(actualExport.activities.length).toBe(12);

      done();
    }, () => { done.fail("Should not have an error!"); });
  });

  describe("should throw an error if", () => {
    it("the input file does not exist", (done) => {

      // Arrange
      const sut = new SaxoConverter(new SecurityService(new YahooFinanceServiceMock()));

      let tempFileName = "tmp/testinput/saxo-filedoesnotexist.csv";

      // Act
      sut.readAndProcessFile(tempFileName, () => { done.fail("Should not succeed!"); }, (err: Error) => {

        // Assert
        expect(err).toBeTruthy();

        done();
      });
    });

    it("the input file is empty", (done) => {

      // Arrange
      const sut = new SaxoConverter(new SecurityService(new YahooFinanceServiceMock()));

      let tempFileContent = "";
      tempFileContent += `Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate\n`;

      // Act
      sut.processFileContents(tempFileContent, () => { done.fail("Should not succeed!"); }, (err: Error) => {

        // Assert
        expect(err).toBeTruthy();
        expect(err.message).toContain("An error ocurred while parsing");

        done();
      });
    });

    it("the header and row column count doesn't match", (done) => {

      // Arrange
      const sut = new SaxoConverter(new SecurityService(new YahooFinanceServiceMock()));

      let tempFileContent = "";
      tempFileContent += `Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate\n`;
      tempFileContent += `,30-Dec-2024,02-Jan-2025,Trade,Vanguard FTSE All-World UCITS ETF,IE00BK5BQT80,USD,London Stock Exchange (ETFs),VWRA:xlon,Buy 3 @ 139.74 USD,"-422,99",,1,,`;

      // Act
      sut.processFileContents(tempFileContent, () => { done.fail("Should not succeed!"); }, (err: Error) => {

        // Assert
        expect(err).toBeTruthy();
        expect(err.message).toBe("An error ocurred while parsing! Details: Invalid Record Length: columns length is 13, got 15 on line 2");

        done();
      });
    });

    it("Yahoo Finance throws an error", (done) => {

      // Arrange
      let tempFileContent = "";
      tempFileContent += `Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate\n`;
      tempFileContent += `,30-Dec-2024,02-Jan-2025,Trade,Vanguard FTSE All-World UCITS ETF,VWRA,USD,London Stock Exchange (ETFs),VWRA:xlon,Buy 3 @ 139.74 USD,"-422,99",,1`;

      // Mock Yahoo Finance service to throw error.
      const yahooFinanceServiceMock = new YahooFinanceServiceMock();
      jest.spyOn(yahooFinanceServiceMock, "search").mockImplementation(() => { throw new Error("Unit test error"); });
      const sut = new SaxoConverter(new SecurityService(yahooFinanceServiceMock));

      // Act
      sut.processFileContents(tempFileContent, () => { done.fail("Should not succeed!"); }, (err: Error) => {

        // Assert
        expect(err).toBeTruthy();
        expect(err.message).toContain("Unit test error");

        done();
      });
    });
  });

  it("should log when Yahoo Finance returns no symbol", (done) => {

    // Arrange
    let tempFileContent = "";
    tempFileContent += `Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate\n`;
      tempFileContent += `,30-Dec-2024,02-Jan-2025,Trade,Vanguard FTSE All-World UCITS ETF,IE00BK5BQT80,USD,London Stock Exchange (ETFs),VWRA:xlon,Buy 3 @ 139.74 USD,"-422,99",,1`;

    // Mock Yahoo Finance service to return no quotes.
    const yahooFinanceServiceMock = new YahooFinanceServiceMock();
    jest.spyOn(yahooFinanceServiceMock, "search").mockImplementation(() => { return Promise.resolve({ quotes: [] }) });
    const sut = new SaxoConverter(new SecurityService(yahooFinanceServiceMock));

    // Bit hacky, but it works.
    const consoleSpy = jest.spyOn((sut as any).progress, "log");

    // Act
    sut.processFileContents(tempFileContent, () => {

      expect(consoleSpy).toHaveBeenCalledWith("[i] No result found for buy action for IE00BK5BQT80 with currency USD! Please add this manually..\n");

      done();
    }, () => done.fail("Should not have an error!"));
  });
});
