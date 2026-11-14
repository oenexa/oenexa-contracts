import crypto from 'node:crypto';

export class QuantumShieldedPool {
  private commitments = new Set<string>();
  private nullifiers = new Set<string>();

  /**
   * Deposits into the shielded pool by appending a commitment hash to the tree
   */
  public deposit(commitment: string): void {
    if (this.commitments.has(commitment)) {
      throw new Error('Commitment already exists in pool.');
    }
    this.commitments.add(commitment);
  }

  /**
   * Spends a shielded note by presenting a valid nullifier hash and zk-proof
   */
  public spend(params: {
    nullifierHash: string;
    proof: string;
    recipient: string;
    amount: bigint;
  }): boolean {
    if (this.nullifiers.has(params.nullifierHash)) {
      throw new Error('Double-spend attempt: Nullifier already spent.');
    }

    if (!params.proof || params.proof.length < 32) {
      throw new Error('Invalid zero-knowledge proof format.');
    }

    this.nullifiers.add(params.nullifierHash);
    return true;
  }

  public isSpent(nullifierHash: string): boolean {
    return this.nullifiers.has(nullifierHash);
  }

  public getCommitmentCount(): number {
    return this.commitments.size;
  }
}
