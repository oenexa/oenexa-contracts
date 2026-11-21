import { describe, it, expect } from 'vitest';
import { OenexaProofOfReserves } from '../contracts/OenexaProofOfReserves';
import { OenexaMpcVault } from '../contracts/OenexaMpcVault';
import { createHash } from 'crypto';

describe('Oenexa Custody & Solvency Smart Contracts Suite', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const auditor = '0x2222222222222222222222222222222222222222';
  const newAuditor = '0x3333333333333333333333333333333333333333';
  const kmsSigner = '0x4444444444444444444444444444444444444444';
  const coSigner = '0x5555555555555555555555555555555555555555';
  const recoverySigner = '0x6666666666666666666666666666666666666666';
  const destination = '0x7777777777777777777777777777777777777777';

  describe('OenexaProofOfReserves Contract', () => {
    it('initializes owner and auditor correctly and permits auditor updates', () => {
      const por = new OenexaProofOfReserves(auditor, owner);
      expect(por.auditor).toBe(auditor.toLowerCase());
      expect(por.owner).toBe(owner.toLowerCase());

      por.setAuditor(owner, newAuditor);
      expect(por.auditor).toBe(newAuditor.toLowerCase());

      expect(() => por.setAuditor(auditor, newAuditor)).toThrow('Unauthorized: Only owner');
      expect(() => por.setAuditor(owner, '0x0000000000000000000000000000000000000000')).toThrow(
        'Invalid auditor address'
      );
    });

    it('publishes valid attestation and computes correct basis point ratio', () => {
      const por = new OenexaProofOfReserves(auditor, owner);

      const att = por.publishAttestation({
        caller: auditor,
        epochId: 101,
        merkleRoot: '0x9999999999999999999999999999999999999999999999999999999999999999',
        totalLiabilitiesUSD: 100_000_000n, // $100M
        totalReservesUSD: 117_500_000n,    // $117.5M
        auditorSignature: '0xaudit_sig_hex_101',
      });

      expect(att.reserveRatioBps).toBe(11750); // 117.50%
      expect(por.getAttestationsCount()).toBe(1);
      expect(por.getLatestAttestation().epochId).toBe(101);
    });

    it('rejects under-collateralized attestations (< 100% solvency ratio)', () => {
      const por = new OenexaProofOfReserves(auditor, owner);

      expect(() =>
        por.publishAttestation({
          caller: auditor,
          epochId: 102,
          merkleRoot: '0xroot',
          totalLiabilitiesUSD: 100_000_000n,
          totalReservesUSD: 99_000_000n, // Fractional reserve forbidden
          auditorSignature: '0xsig',
        })
      ).toThrow('Reserves must cover 100% of liabilities');
    });

    it('rejects duplicate epoch publication', () => {
      const por = new OenexaProofOfReserves(auditor, owner);

      por.publishAttestation({
        caller: auditor,
        epochId: 103,
        merkleRoot: '0xroot',
        totalLiabilitiesUSD: 100_000_000n,
        totalReservesUSD: 105_000_000n,
        auditorSignature: '0xsig',
      });

      expect(() =>
        por.publishAttestation({
          caller: auditor,
          epochId: 103,
          merkleRoot: '0xroot_diff',
          totalLiabilitiesUSD: 100_000_000n,
          totalReservesUSD: 105_000_000n,
          auditorSignature: '0xsig',
        })
      ).toThrow('Epoch already recorded');
    });

    it('cryptographically verifies Merkle inclusion proofs', () => {
      const leaf1 = '0x' + createHash('sha256').update('user1:asset:100:salt1').digest('hex');
      const leaf2 = '0x' + createHash('sha256').update('user2:asset:200:salt2').digest('hex');

      // Sort pairs
      let combined: Buffer;
      if (leaf1.toLowerCase() <= leaf2.toLowerCase()) {
        combined = Buffer.concat([
          Buffer.from(leaf1.replace(/^0x/, ''), 'hex'),
          Buffer.from(leaf2.replace(/^0x/, ''), 'hex'),
        ]);
      } else {
        combined = Buffer.concat([
          Buffer.from(leaf2.replace(/^0x/, ''), 'hex'),
          Buffer.from(leaf1.replace(/^0x/, ''), 'hex'),
        ]);
      }
      const root = '0x' + createHash('sha256').update(combined).digest('hex');

      // Verify leaf1 with sibling leaf2
      const isValid = OenexaProofOfReserves.verifyInclusion([leaf2], root, leaf1);
      expect(isValid).toBe(true);

      // Verify failure on altered leaf
      const fakeLeaf = '0x' + createHash('sha256').update('tampered_balance').digest('hex');
      const isInvalid = OenexaProofOfReserves.verifyInclusion([leaf2], root, fakeLeaf);
      expect(isInvalid).toBe(false);
    });
  });

  describe('OenexaMpcVault Contract', () => {
    it('initializes 2-of-3 signers and enforces access control', () => {
      const vault = new OenexaMpcVault(kmsSigner, coSigner, recoverySigner);
      expect(vault.isSigner(kmsSigner)).toBe(true);
      expect(vault.isSigner(coSigner)).toBe(true);
      expect(vault.isSigner(recoverySigner)).toBe(true);
      expect(vault.isSigner(destination)).toBe(false);

      expect(() => vault.setEmergencyPause(destination, true)).toThrow('Unauthorized');
      vault.setEmergencyPause(kmsSigner, true);
      expect(vault.paused).toBe(true);
      vault.setEmergencyPause(kmsSigner, false);
      expect(vault.paused).toBe(false);
    });

    it('executes hot withdrawal instantly once 2-of-3 signers approve', () => {
      const vault = new OenexaMpcVault(kmsSigner, coSigner, recoverySigner);
      vault.depositNative(50n * 10n ** 18n);

      // Hot withdrawal <= 10,000 ONXC
      const proposalId = vault.proposeWithdrawal({
        caller: kmsSigner,
        destination,
        amount: 5n * 10n ** 18n,
        token: '0x0000000000000000000000000000000000000000',
      });

      // Try executing with only 1 signature -> fails
      expect(() => vault.executeWithdrawal(kmsSigner, proposalId)).toThrow(
        'Insufficient threshold approvals'
      );

      // Second approval by Co-Signer
      vault.approveProposal(coSigner, proposalId);

      // Execute now succeeds
      const executed = vault.executeWithdrawal(kmsSigner, proposalId);
      expect(executed).toBe(true);
      expect(vault.getNativeBalance()).toBe(45n * 10n ** 18n);
      expect(vault.getProposal(proposalId)?.executed).toBe(true);
    });

    it('enforces 24-hour timelock delay for cold storage withdrawals (> 10,000 threshold)', () => {
      const vault = new OenexaMpcVault(kmsSigner, coSigner, recoverySigner);
      vault.depositNative(100_000n * 10n ** 18n);

      // Cold storage withdrawal > 10,000 ONXC
      const now = Math.floor(Date.now() / 1000);
      const proposalId = vault.proposeWithdrawal({
        caller: kmsSigner,
        destination,
        amount: 25_000n * 10n ** 18n,
        token: '0x0000000000000000000000000000000000000000',
      });

      vault.approveProposal(coSigner, proposalId);

      // Attempt immediate execution -> fails timelock
      expect(() => vault.executeWithdrawal(kmsSigner, proposalId, now + 100)).toThrow(
        'Timelock delay has not expired yet'
      );

      // Attempt after 24h + 10s -> succeeds
      const executed = vault.executeWithdrawal(kmsSigner, proposalId, now + 86410);
      expect(executed).toBe(true);
      expect(vault.getNativeBalance()).toBe(75_000n * 10n ** 18n);
    });

    it('prevents double approvals from the same signer', () => {
      const vault = new OenexaMpcVault(kmsSigner, coSigner, recoverySigner);
      const proposalId = vault.proposeWithdrawal({
        caller: kmsSigner,
        destination,
        amount: 1n * 10n ** 18n,
        token: '0x0000000000000000000000000000000000000000',
      });

      expect(() => vault.approveProposal(kmsSigner, proposalId)).toThrow(
        'Signer has already approved'
      );
    });
  });
});
