export class SaxoRecord {
    clientId: string;
    tradeDate: Date;
    valueDate: Date;
    type: string;
    instrument: string;
    instrumentIsin;
    instrumentCurrency: string;
    exchange: string;
    description: string;
    instrumentSymbol: string;
    event: string;
    amount: number;
    orderId: string;
    conversionRate: number;
}
