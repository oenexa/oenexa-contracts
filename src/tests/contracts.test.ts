import { describe, it, expect } from 'vitest';
import { OnxcToken } from '../contracts/OnxcToken';
import { QuantumShieldedPool } from '../contracts/QuantumShieldedPool';
import { OenexaEscrow, OrderState } from '../contracts/OenexaEscrow';
import { OenexaLiquidityPool } from '../contracts/OenexaLiquidityPool';
import { OenexaUSD } from '../contracts/OenexaUSD';

describe('OENEXA Smart Contracts Test Suite', () => {
  it('verifies ONXCToken mint, transfer, approve, and burn operations', () => {
    const owner = '0x1111111111111111111111111111111111111111';
    const alice = '0x2222222222222222222222222222222222222222';
    const bob = '0x3333333333333333333333333333333333333333';

    const token = new OnxcToken(1_000_000n * 10n ** 18n, owner);
    expect(token.totalSupply()).toBe(1_000_000n * 10n ** 18n);
    expect(token.balanceOf(owner)).toBe(1_000_000n * 10n ** 18n);

    // Transfer
    token.transfer(owner, alice, 500n * 10n ** 18n);
    expect(token.balanceOf(alice)).toBe(500n * 10n ** 18n);

    // Approve & TransferFrom
    token.approve(alice, bob, 200n * 10n ** 18n);
    expect(token.allowance(alice, bob)).toBe(200n * 10n ** 18n);
    token.transferFrom(bob, alice, bob, 150n * 10n ** 18n);
    expect(token.balanceOf(bob)).toBe(150n * 10n ** 18n);
    expect(token.allowance(alice, bob)).toBe(50n * 10n ** 18n);

    // Burn
    token.burn(bob, 50n * 10n ** 18n);
    expect(token.balanceOf(bob)).toBe(100n * 10n ** 18n);
  });

  it('verifies QuantumShieldedPool commitment and anti-double-spend nullifiers', () => {
    const pool = new QuantumShieldedPool();
    const commitment = '0xcommitment_hash_abc123';
    const nullifier = '0xnullifier_hash_xyz789';

    pool.deposit(commitment);
    expect(pool.getCommitmentCount()).toBe(1);

    // Spend
    const success = pool.spend({
      nullifierHash: nullifier,
      proof: '0xmock_zk_snark_proof_bytes_with_sufficient_length_here_123',
      recipient: '0xrecipient_addr',
      amount: 100n,
    });
    expect(success).toBe(true);
    expect(pool.isSpent(nullifier)).toBe(true);

    // Double-spend rejection
    expect(() => {
      pool.spend({
        nullifierHash: nullifier,
        proof: '0xmock_zk_snark_proof_bytes_with_sufficient_length_here_123',
        recipient: '0xrecipient_addr',
        amount: 100n,
      });
    }).toThrow('Double-spend attempt');
  });

  it('verifies OenexaEscrow lifecycle with atomic delivery payouts', () => {
    const owner = '0xowner';
    const customer = '0xcustomer';
    const merchant = '0xmerchant';
    const driver = '0xdriver';
    const feeCollector = '0xfeecollector';

    const token = new OnxcToken(10_000n * 10n ** 18n, owner);
    token.transfer(owner, customer, 100n * 10n ** 18n);

    const escrow = new OenexaEscrow(token, feeCollector, owner);

    // 1. Customer creates order (total: 25 ONXC = 20 merchant + 4 driver + 1 protocol)
    const order = escrow.createOrder({
      orderId: 'ord-8831',
      customer,
      merchant,
      merchantPayout: 20n * 10n ** 18n,
      driverFee: 4n * 10n ** 18n,
      protocolFee: 1n * 10n ** 18n,
    });
    expect(order.state).toBe(OrderState.CREATED);

    // 2. Merchant accepts order
    escrow.acceptOrder('ord-8831', merchant);
    expect(escrow.getOrder('ord-8831')?.state).toBe(OrderState.PREPARING);

    // 3. Assign Driver
    escrow.assignDriver('ord-8831', driver);
    expect(escrow.getOrder('ord-8831')?.state).toBe(OrderState.DISPATCHED);

    // 4. Complete Delivery -> Atomic Multi-Party Disbursals
    escrow.completeDelivery('ord-8831', '0xproof_photo_hash_8892');
    expect(escrow.getOrder('ord-8831')?.state).toBe(OrderState.DELIVERED);

    expect(token.balanceOf(merchant)).toBe(20n * 10n ** 18n);
    expect(token.balanceOf(driver)).toBe(4n * 10n ** 18n);
    expect(token.balanceOf(feeCollector)).toBe(1n * 10n ** 18n);
  });

  it('verifies OenexaLiquidityPool constant-product AMM swap and fee mechanics', () => {
    const owner = '0xowner';
    const trader = '0xtrader';

    const token0 = new OnxcToken(1_000_000n * 10n ** 18n, owner);
    const token1 = new OnxcToken(1_000_000n * 10n ** 18n, owner);

    token0.transfer(owner, trader, 1_000n * 10n ** 18n);

    const pool = new OenexaLiquidityPool(token0, token1);

    // Add initial liquidity: 10,000 token0 and 25,000 token1 (ratio 1:2.5)
    const lpMinted = pool.addLiquidity({
      provider: owner,
      amount0: 10_000n * 10n ** 18n,
      amount1: 25_000n * 10n ** 18n,
    });
    expect(lpMinted).toBeGreaterThan(0n);
    expect(pool.reserve0).toBe(10_000n * 10n ** 18n);
    expect(pool.reserve1).toBe(25_000n * 10n ** 18n);

    // Swap 100 token0 for token1
    const amountOut = pool.swap({
      sender: trader,
      amountIn: 100n * 10n ** 18n,
      zeroForOne: true,
      recipient: trader,
    });
    expect(amountOut).toBeGreaterThan(0n);
    expect(token1.balanceOf(trader)).toBe(amountOut);
  });

  it('verifies OenexaUSD mint, transfer, and burn', () => {
    const minter = '0xminter';
    const alice = '0xalice';
    const usd = new OenexaUSD(minter);

    usd.mint(minter, alice, 50_000_000n); // 50.00 USD
    expect(usd.balanceOf(alice)).toBe(50_000_000n);
    expect(usd.totalSupply()).toBe(50_000_000n);

    usd.burn(alice, 20_000_000n);
    expect(usd.balanceOf(alice)).toBe(30_000_000n);
  });
});
