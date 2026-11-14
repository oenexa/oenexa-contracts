export class OnxcToken {
  public readonly name = 'OENEXA Native Coin';
  public readonly symbol = 'ONXC';
  public readonly decimals = 18;
  private _totalSupply: bigint;
  private balances = new Map<string, bigint>();
  private allowances = new Map<string, Map<string, bigint>>(); // owner -> spender -> amount

  constructor(initialSupply: bigint = 1_000_000_000n * 10n ** 18n, owner: string = '0x0000000000000000000000000000000000000001') {
    this._totalSupply = initialSupply;
    this.balances.set(owner.toLowerCase(), initialSupply);
  }

  public totalSupply(): bigint {
    return this._totalSupply;
  }

  public balanceOf(account: string): bigint {
    return this.balances.get(account.toLowerCase()) || 0n;
  }

  public transfer(from: string, to: string, amount: bigint): boolean {
    if (amount <= 0n) throw new Error('Transfer amount must be greater than zero.');
    const senderBal = this.balanceOf(from);
    if (senderBal < amount) throw new Error('Insufficient balance.');

    this.balances.set(from.toLowerCase(), senderBal - amount);
    const recipientBal = this.balanceOf(to);
    this.balances.set(to.toLowerCase(), recipientBal + amount);
    return true;
  }

  public approve(owner: string, spender: string, amount: bigint): boolean {
    const ownerKey = owner.toLowerCase();
    const spenderKey = spender.toLowerCase();
    let spenderMap = this.allowances.get(ownerKey);
    if (!spenderMap) {
      spenderMap = new Map<string, bigint>();
      this.allowances.set(ownerKey, spenderMap);
    }
    spenderMap.set(spenderKey, amount);
    return true;
  }

  public allowance(owner: string, spender: string): bigint {
    return this.allowances.get(owner.toLowerCase())?.get(spender.toLowerCase()) || 0n;
  }

  public transferFrom(spender: string, from: string, to: string, amount: bigint): boolean {
    const allowed = this.allowance(from, spender);
    if (allowed < amount) throw new Error('Insufficient allowance.');

    this.transfer(from, to, amount);
    this.approve(from, spender, allowed - amount);
    return true;
  }

  public burn(account: string, amount: bigint): boolean {
    const bal = this.balanceOf(account);
    if (bal < amount) throw new Error('Insufficient balance to burn.');
    this.balances.set(account.toLowerCase(), bal - amount);
    this._totalSupply -= amount;
    return true;
  }
}
