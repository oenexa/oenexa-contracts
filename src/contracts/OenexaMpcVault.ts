import { createHash } from 'crypto';

export interface WithdrawalProposalData {
  proposalId: string;
  destination: string;
  amount: bigint;
  token: string;
  initiatedAt: number;
  executionTime: number;
  approvalCount: number;
  approvals: Set<string>;
  executed: boolean;
}

export class OenexaMpcVault {
  public readonly signers: [string, string, string];
  public readonly threshold = 2;
  public readonly timelockColdDelay = 86400; // 24 hours in seconds
  public hotWithdrawalCeiling: bigint = 10_000n * 10n ** 18n;
  public paused: boolean = false;
  private proposals = new Map<string, WithdrawalProposalData>();
  private nativeBalance: bigint = 0n;

  constructor(kms: string, coSigner: string, recovery: string) {
    if (!kms || !coSigner || !recovery) throw new Error('Invalid signers');
    this.signers = [kms.toLowerCase(), coSigner.toLowerCase(), recovery.toLowerCase()];
  }

  public isSigner(account: string): boolean {
    const acc = account.toLowerCase();
    return this.signers.includes(acc);
  }

  public setEmergencyPause(caller: string, isPaused: boolean): void {
    if (!this.isSigner(caller)) throw new Error('Unauthorized: Sender is not an authorized MPC signer');
    this.paused = isPaused;
  }

  public depositNative(amount: bigint): void {
    if (amount <= 0n) throw new Error('Amount must be > 0');
    this.nativeBalance += amount;
  }

  public getNativeBalance(): bigint {
    return this.nativeBalance;
  }

  public proposeWithdrawal(params: {
    caller: string;
    destination: string;
    amount: bigint;
    token: string;
  }): string {
    if (!this.isSigner(params.caller)) throw new Error('Unauthorized: Sender is not an authorized MPC signer');
    if (this.paused) throw new Error('Vault operations are currently paused by security council');
    if (!params.destination) throw new Error('Invalid destination');
    if (params.amount <= 0n) throw new Error('Amount must be > 0');

    const now = Math.floor(Date.now() / 1000);
    const proposalId = '0x' + createHash('sha256')
      .update(`${params.destination.toLowerCase()}:${params.amount.toString()}:${params.token.toLowerCase()}:${now}`)
      .digest('hex');

    if (this.proposals.has(proposalId)) throw new Error('Proposal already exists');

    const delay = params.amount > this.hotWithdrawalCeiling ? this.timelockColdDelay : 0;
    const proposal: WithdrawalProposalData = {
      proposalId,
      destination: params.destination.toLowerCase(),
      amount: params.amount,
      token: params.token.toLowerCase(),
      initiatedAt: now,
      executionTime: now + delay,
      approvalCount: 1,
      approvals: new Set([params.caller.toLowerCase()]),
      executed: false,
    };

    this.proposals.set(proposalId, proposal);
    return proposalId;
  }

  public approveProposal(caller: string, proposalId: string): void {
    if (!this.isSigner(caller)) throw new Error('Unauthorized: Sender is not an authorized MPC signer');
    if (this.paused) throw new Error('Vault operations are currently paused by security council');

    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Proposal does not exist');
    if (proposal.executed) throw new Error('Proposal already executed');

    const callerKey = caller.toLowerCase();
    if (proposal.approvals.has(callerKey)) throw new Error('Signer has already approved');

    proposal.approvals.add(callerKey);
    proposal.approvalCount += 1;
  }

  public executeWithdrawal(caller: string, proposalId: string, currentTimeOverride?: number): boolean {
    if (!this.isSigner(caller)) throw new Error('Unauthorized: Sender is not an authorized MPC signer');
    if (this.paused) throw new Error('Vault operations are currently paused by security council');

    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Proposal does not exist');
    if (proposal.executed) throw new Error('Proposal already executed');
    if (proposal.approvalCount < this.threshold) {
      throw new Error('Insufficient threshold approvals (needs 2-of-3)');
    }

    const now = currentTimeOverride ?? Math.floor(Date.now() / 1000);
    if (now < proposal.executionTime) {
      throw new Error('Timelock delay has not expired yet');
    }

    if (proposal.token === '0x0000000000000000000000000000000000000000') {
      if (this.nativeBalance < proposal.amount) throw new Error('Insufficient vault native balance');
      this.nativeBalance -= proposal.amount;
    }

    proposal.executed = true;
    return true;
  }

  public getProposal(proposalId: string): WithdrawalProposalData | undefined {
    return this.proposals.get(proposalId);
  }
}
