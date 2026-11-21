// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title OenexaEscrow
 * @notice Multi-party escrow for OENEXA on-demand peer-to-peer commerce and settlements.
 * Holds customer deposit, allows merchant acceptance, driver assignment,
 * and atomic settlement on cryptographic proof of delivery.
 */
contract OenexaEscrow {
    enum OrderState { CREATED, PREPARING, DISPATCHED, DELIVERED, REFUNDED }

    struct EscrowOrder {
        string orderId;
        address customer;
        address merchant;
        address driver;
        uint256 merchantPayout;
        uint256 driverFee;
        uint256 protocolFee;
        OrderState state;
        uint256 createdAt;
        bytes32 deliveryProofHash;
    }

    address public protocolFeeCollector;
    address public arbiter;
    IERC20 public onxcToken;

    mapping(string => EscrowOrder) public orders;

    event OrderCreated(string indexed orderId, address indexed customer, uint256 totalAmount);
    event OrderPreparing(string indexed orderId, address indexed merchant);
    event OrderDispatched(string indexed orderId, address indexed driver);
    event OrderDelivered(string indexed orderId, address indexed driver, bytes32 proof);
    event OrderRefunded(string indexed orderId, string reason);

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "OenexaEscrow: Only arbiter");
        _;
    }

    constructor(address _onxcToken, address _protocolFeeCollector, address _arbiter) {
        onxcToken = IERC20(_onxcToken);
        protocolFeeCollector = _protocolFeeCollector;
        arbiter = _arbiter;
    }

    function createOrder(
        string calldata orderId,
        address merchant,
        uint256 merchantPayout,
        uint256 driverFee,
        uint256 protocolFee
    ) external {
        require(orders[orderId].customer == address(0), "OenexaEscrow: Order exists");
        require(merchant != address(0), "OenexaEscrow: Invalid merchant");

        uint256 total = merchantPayout + driverFee + protocolFee;
        require(onxcToken.transferFrom(msg.sender, address(this), total), "OenexaEscrow: Transfer failed");

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            customer: msg.sender,
            merchant: merchant,
            driver: address(0),
            merchantPayout: merchantPayout,
            driverFee: driverFee,
            protocolFee: protocolFee,
            state: OrderState.CREATED,
            createdAt: block.timestamp,
            deliveryProofHash: bytes32(0)
        });

        emit OrderCreated(orderId, msg.sender, total);
    }

    function acceptOrder(string calldata orderId) external {
        EscrowOrder storage order = orders[orderId];
        require(msg.sender == order.merchant, "OenexaEscrow: Not the merchant");
        require(order.state == OrderState.CREATED, "OenexaEscrow: Invalid state");

        order.state = OrderState.PREPARING;
        emit OrderPreparing(orderId, msg.sender);
    }

    function assignDriver(string calldata orderId, address driver) external {
        EscrowOrder storage order = orders[orderId];
        require(msg.sender == arbiter || msg.sender == order.merchant, "OenexaEscrow: Unauthorized");
        require(order.state == OrderState.PREPARING, "OenexaEscrow: Not ready for dispatch");

        order.driver = driver;
        order.state = OrderState.DISPATCHED;
        emit OrderDispatched(orderId, driver);
    }

    function completeDelivery(string calldata orderId, bytes32 proofHash) external {
        EscrowOrder storage order = orders[orderId];
        require(order.state == OrderState.DISPATCHED, "OenexaEscrow: Not dispatched");
        require(msg.sender == order.driver || msg.sender == order.customer || msg.sender == arbiter, "OenexaEscrow: Unauthorized");

        order.state = OrderState.DELIVERED;
        order.deliveryProofHash = proofHash;

        // Atomic multi-rail payouts
        require(onxcToken.transfer(order.merchant, order.merchantPayout), "OenexaEscrow: Merchant payout failed");
        require(onxcToken.transfer(order.driver, order.driverFee), "OenexaEscrow: Driver payout failed");
        if (order.protocolFee > 0) {
            require(onxcToken.transfer(protocolFeeCollector, order.protocolFee), "OenexaEscrow: Protocol fee failed");
        }

        emit OrderDelivered(orderId, order.driver, proofHash);
    }

    function refundOrder(string calldata orderId, string calldata reason) external {
        EscrowOrder storage order = orders[orderId];
        require(order.state != OrderState.DELIVERED && order.state != OrderState.REFUNDED, "OenexaEscrow: Finalized");
        require(msg.sender == arbiter || (msg.sender == order.merchant && order.state == OrderState.CREATED), "OenexaEscrow: Unauthorized");

        order.state = OrderState.REFUNDED;
        uint256 total = order.merchantPayout + order.driverFee + order.protocolFee;
        require(onxcToken.transfer(order.customer, total), "OenexaEscrow: Refund failed");

        emit OrderRefunded(orderId, reason);
    }
}
