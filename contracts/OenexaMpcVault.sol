// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OenexaMpcVault
 * @notice Institutional Multi-Party Computation (MPC) Custody Vault with 2-of-3 threshold
 * signing, timelocked withdrawals, and emergency pause controls.
 */
contract OenexaMpcVault {
    address[3] public signers; // 0: Exchange KMS, 1: Co-Signer Policy, 2: Disaster Recovery Custodian
    uint256 public constant THRESHOLD = 2; // 2-of-3 threshold
    uint256 public constant TIMELOCK_COLD_DELAY = 1 days;

    uint256 public hotWithdrawalCeiling = 10_000 ether; // Daily hot ceiling
    bool public paused;

    struct WithdrawalProposal {
        bytes32 proposalId;
        address destination;
        uint256 amount;
        address token;
        uint256 initiatedAt;
        uint256 executionTime;
        uint8 approvalCount;
        bool executed;
        mapping(address => bool) approvals;
    }

    mapping(bytes32 => WithdrawalProposal) public proposals;

    event SignerUpdated(uint8 indexed index, address indexed oldSigner, address indexed newSigner);
    event ProposalInitiated(bytes32 indexed proposalId, address indexed destination, uint256 amount, uint256 executionTime);
    event ProposalApproved(bytes32 indexed proposalId, address indexed signer);
    event ProposalExecuted(bytes32 indexed proposalId, address indexed destination, uint256 amount);
    event EmergencyPauseToggled(bool isPaused);

    modifier onlySigner() {
        require(isSigner(msg.sender), "Unauthorized: Sender is not an authorized MPC signer");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Vault operations are currently paused by security council");
        _;
    }

    constructor(address _kms, address _coSigner, address _recovery) {
        require(_kms != address(0) && _coSigner != address(0) && _recovery != address(0), "Invalid signers");
        signers[0] = _kms;
        signers[1] = _coSigner;
        signers[2] = _recovery;
    }

    function isSigner(address _account) public view returns (bool) {
        return _account == signers[0] || _account == signers[1] || _account == signers[2];
    }

    function setEmergencyPause(bool _paused) external onlySigner {
        paused = _paused;
        emit EmergencyPauseToggled(_paused);
    }

    function proposeWithdrawal(
        address _destination,
        uint256 _amount,
        address _token
    ) external onlySigner whenNotPaused returns (bytes32) {
        require(_destination != address(0), "Invalid destination");
        require(_amount > 0, "Amount must be > 0");

        bytes32 proposalId = keccak256(abi.encodePacked(_destination, _amount, _token, block.timestamp));
        WithdrawalProposal storage proposal = proposals[proposalId];
        require(proposal.proposalId == bytes32(0), "Proposal already exists");

        uint256 delay = _amount > hotWithdrawalCeiling ? TIMELOCK_COLD_DELAY : 0;

        proposal.proposalId = proposalId;
        proposal.destination = _destination;
        proposal.amount = _amount;
        proposal.token = _token;
        proposal.initiatedAt = block.timestamp;
        proposal.executionTime = block.timestamp + delay;
        proposal.approvalCount = 1;
        proposal.approvals[msg.sender] = true;
        proposal.executed = false;

        emit ProposalInitiated(proposalId, _destination, _amount, proposal.executionTime);
        emit ProposalApproved(proposalId, msg.sender);

        return proposalId;
    }

    function approveProposal(bytes32 _proposalId) external onlySigner whenNotPaused {
        WithdrawalProposal storage proposal = proposals[_proposalId];
        require(proposal.proposalId != bytes32(0), "Proposal does not exist");
        require(!proposal.executed, "Proposal already executed");
        require(!proposal.approvals[msg.sender], "Signer has already approved");

        proposal.approvals[msg.sender] = true;
        proposal.approvalCount += 1;

        emit ProposalApproved(_proposalId, msg.sender);
    }

    function executeWithdrawal(bytes32 _proposalId) external onlySigner whenNotPaused {
        WithdrawalProposal storage proposal = proposals[_proposalId];
        require(proposal.proposalId != bytes32(0), "Proposal does not exist");
        require(!proposal.executed, "Proposal already executed");
        require(proposal.approvalCount >= THRESHOLD, "Insufficient threshold approvals (needs 2-of-3)");
        require(block.timestamp >= proposal.executionTime, "Timelock delay has not expired yet");

        proposal.executed = true;

        if (proposal.token == address(0)) {
            (bool success, ) = payable(proposal.destination).call{value: proposal.amount}("");
            require(success, "Native transfer failed");
        } else {
            (bool success, bytes memory data) = proposal.token.call(
                abi.encodeWithSignature("transfer(address,uint256)", proposal.destination, proposal.amount)
            );
            require(success && (data.length == 0 || abi.decode(data, (bool))), "Token transfer failed");
        }

        emit ProposalExecuted(_proposalId, proposal.destination, proposal.amount);
    }

    receive() external payable {}
}
