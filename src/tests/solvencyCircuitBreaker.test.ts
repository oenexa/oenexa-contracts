import { describe, it, expect, beforeEach } from 'vitest';

export class MockSolvencyCircuitBreaker {
  public governance: string;
  public emergencyAuditor: string;
  public circuitBreakerTripped = false;
  public tripReason = '';
  public currentEpoch = 0;
  public epochs = new Map<number, any>();
  public timelockedWithdrawals = new Map<string, any>();

  constructor(governance: string, emergencyAuditor: string) {
    this.governance = governance;
    this.emergencyAuditor = emergencyAuditor;
  }

  public publishSolvencyEpoch(merkleRoot: string, totalReservesUsd: bigint, totalLiabilitiesUsd: bigint): number {
    if (totalLiabilitiesUsd <= 0n) throw new Error('Liabilities must be > 0');

    const ratioBps = (totalReservesUsd * 10000n) / totalLiabilitiesUsd;
    this.currentEpoch++;

    this.epochs.set(this.currentEpoch, {
      epochNumber: this.currentEpoch,
      merkleRoot,
      totalReservesUsd,
      totalLiabilitiesUsd,
      solvencyRatioBps: ratioBps,
    });

    if (ratioBps < 10000n) {
      this.circuitBreakerTripped = true;
      this.tripReason = 'SOLVENCY_UNDERCOLLATERALIZATION_DETECTED';
    }

    return this.currentEpoch;
  }

  public queueHighValueWithdrawal(recipient: string, asset: string, amount: bigint, nowSec: number): string {
    if (this.circuitBreakerTripped) throw new Error('OENEXA: Solvency Circuit Breaker is ACTIVE');
    const releaseTime = nowSec + 86400; // 24h
    const id = `w_${this.timelockedWithdrawals.size + 1}`;
    this.timelockedWithdrawals.set(id, {
      id,
      recipient,
      asset,
      amount,
      releaseTime,
      executed: false,
      cancelled: false,
    });
    return id;
  }

  public executeWithdrawal(id: string, nowSec: number): void {
    if (this.circuitBreakerTripped) throw new Error('OENEXA: Solvency Circuit Breaker is ACTIVE');
    const w = this.timelockedWithdrawals.get(id);
    if (!w) throw new Error('Not found');
    if (w.executed) throw new Error('Already executed');
    if (w.cancelled) throw new Error('Withdrawal was cancelled');
    if (nowSec < w.releaseTime) throw new Error('Timelock active');
    w.executed = true;
  }

  public cancelWithdrawal(id: string): void {
    const w = this.timelockedWithdrawals.get(id);
    if (!w) throw new Error('Not found');
    if (w.executed) throw new Error('Already executed');
    w.cancelled = true;
  }

  public resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.tripReason = '';
  }
}

describe('OenexaSolvencyCircuitBreaker Contract Invariants', () => {
  let breaker: MockSolvencyCircuitBreaker;

  beforeEach(() => {
    breaker = new MockSolvencyCircuitBreaker('0xGov', '0xAuditor');
  });

  it('accepts healthy solvency epochs (>= 100%) without tripping breaker', () => {
    const epoch = breaker.publishSolvencyEpoch('0xroot1', 105000000n, 100000000n); // 105%
    expect(epoch).toBe(1);
    expect(breaker.circuitBreakerTripped).toBe(false);
  });

  it('automatically trips circuit breaker if reserve ratio drops below 100%', () => {
    breaker.publishSolvencyEpoch('0xrootUnder', 98000000n, 100000000n); // 98% (undercollateralized)
    expect(breaker.circuitBreakerTripped).toBe(true);
    expect(breaker.tripReason).toBe('SOLVENCY_UNDERCOLLATERALIZATION_DETECTED');
  });

  it('blocks queuing new withdrawals when circuit breaker is tripped', () => {
    breaker.publishSolvencyEpoch('0xrootUnder', 90000000n, 100000000n);
    expect(() => {
      breaker.queueHighValueWithdrawal('0xAlice', '0xUSDT', 50000n, 1000);
    }).toThrow(/Solvency Circuit Breaker is ACTIVE/);
  });

  it('enforces 24-hour timelock on high-value withdrawals before execution', () => {
    const now = 1000000;
    const wId = breaker.queueHighValueWithdrawal('0xBob', '0xBTC', 10n, now);

    // Immediate execution fails
    expect(() => {
      breaker.executeWithdrawal(wId, now + 3600); // 1 hour later
    }).toThrow(/Timelock active/);

    // Execution after 24h succeeds
    breaker.executeWithdrawal(wId, now + 86401);
    expect(breaker.timelockedWithdrawals.get(wId).executed).toBe(true);
  });

  it('allows emergency cancellation of timelocked withdrawals', () => {
    const now = 1000000;
    const wId = breaker.queueHighValueWithdrawal('0xAttacker', '0xETH', 100n, now);
    breaker.cancelWithdrawal(wId);

    expect(() => {
      breaker.executeWithdrawal(wId, now + 90000);
    }).toThrow(/Withdrawal was cancelled/);
  });
});
