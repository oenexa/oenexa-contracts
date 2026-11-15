import { OnxcToken } from './OnxcToken';

export enum OrderState {
  CREATED = 'CREATED',
  PREPARING = 'PREPARING',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  REFUNDED = 'REFUNDED',
}

export interface EscrowOrder {
  orderId: string;
  customer: string;
  merchant: string;
  driver?: string;
  merchantPayout: bigint;
  driverFee: bigint;
  protocolFee: bigint;
  state: OrderState;
  createdAt: number;
  deliveryProofHash?: string;
}

export class OenexaEscrow {
  private orders = new Map<string, EscrowOrder>();
  private token: OnxcToken;
  public readonly protocolFeeCollector: string;
  public readonly arbiter: string;

  constructor(token: OnxcToken, protocolFeeCollector: string, arbiter: string) {
    this.token = token;
    this.protocolFeeCollector = protocolFeeCollector.toLowerCase();
    this.arbiter = arbiter.toLowerCase();
  }

  public createOrder(params: {
    orderId: string;
    customer: string;
    merchant: string;
    merchantPayout: bigint;
    driverFee: bigint;
    protocolFee: bigint;
  }): EscrowOrder {
    if (this.orders.has(params.orderId)) {
      throw new Error(`Order ${params.orderId} already exists in escrow.`);
    }

    const total = params.merchantPayout + params.driverFee + params.protocolFee;
    // Transfer total into escrow contract custody
    this.token.transfer(params.customer, '0xescrow_contract', total);

    const order: EscrowOrder = {
      orderId: params.orderId,
      customer: params.customer.toLowerCase(),
      merchant: params.merchant.toLowerCase(),
      merchantPayout: params.merchantPayout,
      driverFee: params.driverFee,
      protocolFee: params.protocolFee,
      state: OrderState.CREATED,
      createdAt: Date.now(),
    };

    this.orders.set(params.orderId, order);
    return order;
  }

  public acceptOrder(orderId: string, merchant: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (order.merchant !== merchant.toLowerCase()) throw new Error('Unauthorized merchant.');
    if (order.state !== OrderState.CREATED) throw new Error(`Cannot accept order in state ${order.state}`);

    order.state = OrderState.PREPARING;
  }

  public assignDriver(orderId: string, driver: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (order.state !== OrderState.PREPARING) throw new Error('Order not ready for dispatch.');

    order.driver = driver.toLowerCase();
    order.state = OrderState.DISPATCHED;
  }

  public completeDelivery(orderId: string, proofHash: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (order.state !== OrderState.DISPATCHED) throw new Error('Order not dispatched.');

    order.state = OrderState.DELIVERED;
    order.deliveryProofHash = proofHash;

    // Disburse funds atomically from escrow
    this.token.transfer('0xescrow_contract', order.merchant, order.merchantPayout);
    if (order.driver) {
      this.token.transfer('0xescrow_contract', order.driver, order.driverFee);
    }
    if (order.protocolFee > 0n) {
      this.token.transfer('0xescrow_contract', this.protocolFeeCollector, order.protocolFee);
    }
  }

  public refundOrder(orderId: string, reason: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (order.state === OrderState.DELIVERED || order.state === OrderState.REFUNDED) {
      throw new Error('Order already finalized.');
    }

    order.state = OrderState.REFUNDED;
    const total = order.merchantPayout + order.driverFee + order.protocolFee;
    this.token.transfer('0xescrow_contract', order.customer, total);
  }

  public getOrder(orderId: string): EscrowOrder | undefined {
    return this.orders.get(orderId);
  }
}
