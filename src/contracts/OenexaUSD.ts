export class OenexaUSD {
  public readonly name = 'OENEXA Dollar';
  public readonly symbol = 'ONXUSD';
  public readonly decimals = 6;
  private _totalSupply: bigint = 0n;
  private balances = new Map<string, bigint>();
  public minter: string;

  constructor(minter: string = '0x0000000000000000000000000000000000000001') {
    this.minter = minter.toLowerCase();
  }

  public totalSupply(): bigint {
    return this._totalSupply;
  }

  public balanceOf(account: string): bigint {
    return this.balances.get(account.toLowerCase()) || 0n;
  }

  public mint(caller: string, to: string, amount: bigint): void {
    if (caller.toLowerCase() !== this.minter) throw new Error('Unauthorized minter.');
    if (amount <= 0n) throw new Error('Invalid mint amount.');

    const toKey = to.toLowerCase();
    this.balances.set(toKey, (this.balances.get(toKey) || 0n) + amount);
    this._totalSupply += amount;
  }

  public burn(from: string, amount: bigint): void {
    const fromKey = from.toLowerCase();
    const bal = this.balanceOf(fromKey);
    if (bal < amount) throw new Error('Insufficient balance to burn.');

    this.balances.set(fromKey, bal - amount);
    this._totalSupply -= amount;
  }

  public transfer(from: string, to: string, amount: bigint): boolean {
    const fromKey = from.toLowerCase();
    const toKey = to.toLowerCase();
    const bal = this.balanceOf(fromKey);
    if (bal < amount) throw new Error('Insufficient balance.');

    this.balances.set(fromKey, bal - amount);
    this.balances.set(toKey, (this.balances.get(toKey) || 0n) + amount);
    return true;
  }
}
