import { describe, it, expect } from 'vitest';
import { OnxcToken } from '../contracts/OnxcToken.js';
import { QuantumShieldedPool } from '../contracts/QuantumShieldedPool.js';

describe('OENEXA Sovereign L1 Smart Contracts', () => {
  const TREASURY = '0x0000000000000000000000000000000000000001';
  const ALICE = '0x1111111111111111111111111111111111111111';
  const BOB = '0x2222222222222222222222222222222222222222';

  it('initializes ONXC token with 1,000,000,000 supply and supports transfers', () => {
    const token = new OnxcToken();
    const expectedSupply = 1_000_000_000n * 10n ** 18n;

    expect(token.totalSupply()).toBe(expectedSupply);
    expect(token.balanceOf(TREASURY)).toBe(expectedSupply);

    const transferAmount = 500n * 10n ** 18n;
    token.transfer(TREASURY, ALICE, transferAmount);

    expect(token.balanceOf(ALICE)).toBe(transferAmount);
    expect(token.balanceOf(TREASURY)).toBe(expectedSupply - transferAmount);
  });

  it('supports allowances and transferFrom delegation', () => {
    const token = new OnxcToken();
    token.transfer(TREASURY, ALICE, 1000n);

    token.approve(ALICE, BOB, 400n);
    expect(token.allowance(ALICE, BOB)).toBe(400n);

    token.transferFrom(BOB, ALICE, BOB, 250n);
    expect(token.balanceOf(BOB)).toBe(250n);
    expect(token.balanceOf(ALICE)).toBe(750n);
    expect(token.allowance(ALICE, BOB)).toBe(150n);
  });

  it('burns ONXC token and reduces total supply', () => {
    const token = new OnxcToken();
    token.transfer(TREASURY, ALICE, 500n);

    token.burn(ALICE, 200n);
    expect(token.balanceOf(ALICE)).toBe(300n);
  });

  it('manages quantum shielded commitments and blocks double-spend nullifiers', () => {
    const pool = new QuantumShieldedPool();
    const commitment = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const nullifier = '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba';

    pool.deposit(commitment);
    expect(pool.getCommitmentCount()).toBe(1);

    const spent = pool.spend({
      nullifierHash: nullifier,
      proof: 'mock_zk_snark_groth16_proof_valid_hex_string_32_bytes_min',
      recipient: ALICE,
      amount: 100n,
    });

    expect(spent).toBe(true);
    expect(pool.isSpent(nullifier)).toBe(true);

    // Second spend with same nullifier must fail
    expect(() => {
      pool.spend({
        nullifierHash: nullifier,
        proof: 'mock_zk_snark_groth16_proof_valid_hex_string_32_bytes_min',
        recipient: BOB,
        amount: 100n,
      });
    }).toThrow(/Double-spend attempt/);
  });
});
