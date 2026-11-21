import { createHash } from 'crypto';

export interface AttestationRecord {
  epochId: number;
  merkleRoot: string;
  totalLiabilitiesUSD: bigint;
  totalReservesUSD: bigint;
  reserveRatioBps: number;
  timestamp: number;
  auditorSignature: string;
}

export class OenexaProofOfReserves {
  public readonly owner: string;
  public auditor: string;
  private attestations: AttestationRecord[] = [];
  private epochSet = new Set<number>();

  constructor(auditor: string, owner: string = '0x0000000000000000000000000000000000000001') {
    this.owner = owner.toLowerCase();
    this.auditor = auditor.toLowerCase();
  }

  public setAuditor(caller: string, newAuditor: string): void {
    if (caller.toLowerCase() !== this.owner) throw new Error('Unauthorized: Only owner');
    if (!newAuditor || newAuditor === '0x0000000000000000000000000000000000000000') {
      throw new Error('Invalid auditor address');
    }
    this.auditor = newAuditor.toLowerCase();
  }

  public publishAttestation(params: {
    caller: string;
    epochId: number;
    merkleRoot: string;
    totalLiabilitiesUSD: bigint;
    totalReservesUSD: bigint;
    auditorSignature: string;
  }): AttestationRecord {
    const caller = params.caller.toLowerCase();
    if (caller !== this.auditor && caller !== this.owner) {
      throw new Error('Unauthorized: Only auditor or owner');
    }
    if (this.epochSet.has(params.epochId)) {
      throw new Error('Epoch already recorded');
    }
    if (params.totalLiabilitiesUSD <= 0n) {
      throw new Error('Liabilities must be > 0');
    }
    if (params.totalReservesUSD < params.totalLiabilitiesUSD) {
      throw new Error('Reserves must cover 100% of liabilities');
    }

    const ratioBps = Number((params.totalReservesUSD * 10000n) / params.totalLiabilitiesUSD);
    const attestation: AttestationRecord = {
      epochId: params.epochId,
      merkleRoot: params.merkleRoot,
      totalLiabilitiesUSD: params.totalLiabilitiesUSD,
      totalReservesUSD: params.totalReservesUSD,
      reserveRatioBps: ratioBps,
      timestamp: Math.floor(Date.now() / 1000),
      auditorSignature: params.auditorSignature,
    };

    this.attestations.push(attestation);
    this.epochSet.add(params.epochId);
    return attestation;
  }

  public getLatestAttestation(): AttestationRecord {
    if (this.attestations.length === 0) throw new Error('No attestations recorded');
    return this.attestations[this.attestations.length - 1];
  }

  public getAttestationsCount(): number {
    return this.attestations.length;
  }

  public static verifyInclusion(proof: string[], root: string, leaf: string): boolean {
    let currentHash = leaf.toLowerCase();
    const targetRoot = root.toLowerCase();

    for (const sibling of proof) {
      const sib = sibling.toLowerCase();
      let combined: Buffer;
      if (currentHash <= sib) {
        combined = Buffer.concat([
          Buffer.from(currentHash.replace(/^0x/, ''), 'hex'),
          Buffer.from(sib.replace(/^0x/, ''), 'hex'),
        ]);
      } else {
        combined = Buffer.concat([
          Buffer.from(sib.replace(/^0x/, ''), 'hex'),
          Buffer.from(currentHash.replace(/^0x/, ''), 'hex'),
        ]);
      }
      currentHash = '0x' + createHash('sha256').update(combined).digest('hex');
    }

    return currentHash === targetRoot;
  }
}
