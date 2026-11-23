// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OenexaSolvencyCircuitBreaker
 * @notice Banking-Grade On-Chain Solvency Circuit Breaker & Timelock Registry.
 * Automatically freezes automated hot-wallet sweeping and high-tier withdrawals
 * if the audited reserve-to-liability ratio drops below the regulatory safety margin (e.g. 100%).
 */
contract OenexaSolvencyCircuitBreaker {
    // -------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------
    address public immutable governance;
    address public emergencyAuditor;

    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    uint256 public constant MIN_SOLVENCY_RATIO_BPS = 10000; // 100.00% minimum solvency ratio
    uint256 public constant HIGH_VALUE_TIMELOCK_DURATION = 24 hours;

    bool public circuitBreakerTripped;
    string public tripReason;
    uint256 public lastEpochTimestamp;

    struct SolvencyEpoch {
        uint256 epochNumber;
        bytes32 merkleRoot;
        uint256 totalReservesUsd;
        uint256 totalLiabilitiesUsd;
        uint256 solvencyRatioBps;
        uint256 publishedAt;
    }

    struct TimelockedWithdrawal {
        address recipient;
        address asset;
        uint256 amount;
        uint256 releaseTime;
        bool executed;
        bool cancelled;
    }

    mapping(uint256 => SolvencyEpoch) public epochs;
    uint256 public currentEpoch;

    mapping(bytes32 => TimelockedWithdrawal) public timelockedWithdrawals;

    // -------------------------------------------------------------
    // Events
    // -------------------------------------------------------------
    event EpochPublished(
        uint256 indexed epoch,
        bytes32 merkleRoot,
        uint256 totalReservesUsd,
        uint256 totalLiabilitiesUsd,
        uint256 solvencyRatioBps
    );
    event CircuitBreakerTripped(uint256 indexed epoch, string reason, uint256 timestamp);
    event CircuitBreakerReset(address indexed resetBy, uint256 timestamp);
    event HighValueWithdrawalQueued(bytes32 indexed id, address recipient, address asset, uint256 amount, uint256 releaseTime);
    event HighValueWithdrawalExecuted(bytes32 indexed id);
    event HighValueWithdrawalCancelled(bytes32 indexed id);

    // -------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------
    modifier onlyGovernance() {
        require(msg.sender == governance, "OENEXA: Caller is not Governance");
        _;
    }

    modifier onlyAuditorOrGov() {
        require(msg.sender == emergencyAuditor || msg.sender == governance, "OENEXA: Unauthorized auditor");
        _;
    }

    modifier whenNormal() {
        require(!circuitBreakerTripped, "OENEXA: Solvency Circuit Breaker is ACTIVE");
        _;
    }

    // -------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------
    constructor(address _governance, address _emergencyAuditor) {
        require(_governance != address(0), "Invalid governance");
        require(_emergencyAuditor != address(0), "Invalid auditor");
        governance = _governance;
        emergencyAuditor = _emergencyAuditor;
        circuitBreakerTripped = false;
    }

    // -------------------------------------------------------------
    // Proof of Solvency Publishing
    // -------------------------------------------------------------
    function publishSolvencyEpoch(
        bytes32 _merkleRoot,
        uint256 _totalReservesUsd,
        uint256 _totalLiabilitiesUsd
    ) external onlyAuditorOrGov {
        require(_totalLiabilitiesUsd > 0, "Liabilities must be > 0");

        uint256 ratioBps = (_totalReservesUsd * BASIS_POINTS_DIVISOR) / _totalLiabilitiesUsd;

        currentEpoch++;
        epochs[currentEpoch] = SolvencyEpoch({
            epochNumber: currentEpoch,
            merkleRoot: _merkleRoot,
            totalReservesUsd: _totalReservesUsd,
            totalLiabilitiesUsd: _totalLiabilitiesUsd,
            solvencyRatioBps: ratioBps,
            publishedAt: block.timestamp
        });
        lastEpochTimestamp = block.timestamp;

        emit EpochPublished(currentEpoch, _merkleRoot, _totalReservesUsd, _totalLiabilitiesUsd, ratioBps);

        // Automated On-Chain Circuit Breaker Invariant Check
        if (ratioBps < MIN_SOLVENCY_RATIO_BPS) {
            circuitBreakerTripped = true;
            tripReason = "SOLVENCY_UNDERCOLLATERALIZATION_DETECTED";
            emit CircuitBreakerTripped(currentEpoch, tripReason, block.timestamp);
        }
    }

    // -------------------------------------------------------------
    // High-Value Timelocked Withdrawal Escrow
    // -------------------------------------------------------------
    function queueHighValueWithdrawal(
        address _recipient,
        address _asset,
        uint256 _amount
    ) external onlyGovernance whenNormal returns (bytes32 withdrawalId) {
        require(_recipient != address(0), "Invalid recipient");
        require(_amount > 0, "Amount must be > 0");

        uint256 release = block.timestamp + HIGH_VALUE_TIMELOCK_DURATION;
        withdrawalId = keccak256(abi.encodePacked(_recipient, _asset, _amount, release, block.timestamp));

        timelockedWithdrawals[withdrawalId] = TimelockedWithdrawal({
            recipient: _recipient,
            asset: _asset,
            amount: _amount,
            releaseTime: release,
            executed: false,
            cancelled: false
        });

        emit HighValueWithdrawalQueued(withdrawalId, _recipient, _asset, _amount, release);
        return withdrawalId;
    }

    function executeHighValueWithdrawal(bytes32 _withdrawalId) external whenNormal {
        TimelockedWithdrawal storage w = timelockedWithdrawals[_withdrawalId];
        require(!w.executed, "Already executed");
        require(!w.cancelled, "Withdrawal was cancelled");
        require(block.timestamp >= w.releaseTime, "Timelock active");

        w.executed = true;
        emit HighValueWithdrawalExecuted(_withdrawalId);
    }

    function cancelHighValueWithdrawal(bytes32 _withdrawalId) external onlyAuditorOrGov {
        TimelockedWithdrawal storage w = timelockedWithdrawals[_withdrawalId];
        require(!w.executed, "Already executed");
        require(!w.cancelled, "Already cancelled");

        w.cancelled = true;
        emit HighValueWithdrawalCancelled(_withdrawalId);
    }

    // -------------------------------------------------------------
    // Circuit Breaker Management
    // -------------------------------------------------------------
    function tripCircuitBreakerManually(string calldata _reason) external onlyAuditorOrGov {
        circuitBreakerTripped = true;
        tripReason = _reason;
        emit CircuitBreakerTripped(currentEpoch, _reason, block.timestamp);
    }

    function resetCircuitBreaker() external onlyGovernance {
        circuitBreakerTripped = false;
        tripReason = "";
        emit CircuitBreakerReset(msg.sender, block.timestamp);
    }
}
