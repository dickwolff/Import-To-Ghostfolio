export class DeGiroRecord {
    date: string;
    time: string;
    currencyDate: Date;
    product: string;
    isin: string;
    description: string;
    fx: string;
    currency: string;
    amount: string;
    balance_currency: string; // not used, but improtant for hashing
    balance: string; //// not used, but improtant for hashing
    orderId: string;

    public getAmount(): number { return parseFloat(this.amount.replace(",", ".")); }
    public getAbsoluteAmount(): number { return Math.abs(this.getAmount()); }

    static fromPlainObject(obj: any): DeGiroRecord {
      return Object.assign(new DeGiroRecord(), obj);
    }
}
