import { OnxcToken } from './OnxcToken';

export class OenexaLiquidityPool {
  public reserve0: bigint = 0n;
  public reserve1: bigint = 0n;
  public totalLpSupply: bigint = 0n;
  private lpBalances = new Map<string, bigint>();

  constructor(
    public readonly token0: OnxcToken,
    public readonly token1: OnxcToken
  ) {}

  public addLiquidity(params: {
    provider: string;
    amount0: bigint;
    amount1: bigint;
  }): bigint {
    const providerKey = params.provider.toLowerCase();
    this.token0.transfer(params.provider, '0xpool_address', params.amount0);
    this.token1.transfer(params.provider, '0xpool_address', params.amount1);

    let liquidity: bigint;
    if (this.totalLpSupply === 0n) {
      liquidity = this.sqrt(params.amount0 * params.amount1);
    } else {
      const l0 = (params.amount0 * this.totalLpSupply) / this.reserve0;
      const l1 = (params.amount1 * this.totalLpSupply) / this.reserve1;
      liquidity = l0 < l1 ? l0 : l1;
    }

    if (liquidity <= 0n) throw new Error('Insufficient liquidity minted.');

    const currentBal = this.lpBalances.get(providerKey) || 0n;
    this.lpBalances.set(providerKey, currentBal + liquidity);
    this.totalLpSupply += liquidity;

    this.reserve0 += params.amount0;
    this.reserve1 += params.amount1;

    return liquidity;
  }

  public swap(params: {
    sender: string;
    amountIn: bigint;
    zeroForOne: boolean;
    recipient: string;
  }): bigint {
    if (params.amountIn <= 0n) throw new Error('Insufficient input amount.');

    const tokenIn = params.zeroForOne ? this.token0 : this.token1;
    const tokenOut = params.zeroForOne ? this.token1 : this.token0;
    const resIn = params.zeroForOne ? this.reserve0 : this.reserve1;
    const resOut = params.zeroForOne ? this.reserve1 : this.reserve0;

    tokenIn.transfer(params.sender, '0xpool_address', params.amountIn);

    // 0.3% protocol fee (997/1000)
    const amountInWithFee = params.amountIn * 997n;
    const numerator = amountInWithFee * resOut;
    const denominator = (resIn * 1000n) + amountInWithFee;
    const amountOut = numerator / denominator;

    if (amountOut <= 0n || amountOut >= resOut) {
      throw new Error('Invalid output amount.');
    }

    tokenOut.transfer('0xpool_address', params.recipient, amountOut);

    if (params.zeroForOne) {
      this.reserve0 += params.amountIn;
      this.reserve1 -= amountOut;
    } else {
      this.reserve1 += params.amountIn;
      this.reserve0 -= amountOut;
    }

    return amountOut;
  }

  public getLpBalance(provider: string): bigint {
    return this.lpBalances.get(provider.toLowerCase()) || 0n;
  }

  private sqrt(y: bigint): bigint {
    if (y > 3n) {
      let z = y;
      let x = y / 2n + 1n;
      while (x < z) {
        z = x;
        x = (y / x + x) / 2n;
      }
      return z;
    } else if (y !== 0n) {
      return 1n;
    }
    return 0n;
  }
}
