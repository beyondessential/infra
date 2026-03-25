import type { AddressType } from '../consts/AddressType.ts';

/**
 * GatewaySpecAddress describes an address that can be bound to a Gateway.
 */
export interface GatewaySpecAddress {
  /**
   * Type of the address.
   *
   * Custom values have to be domain-prefixed string identifiers (like `acme.io/CustomAddressType`).
   *
   * Default: `IPAddress`.
   */
  type?: AddressType | string;

  /**
   * When a value is unspecified, an implementation SHOULD automatically
   * assign an address matching the requested type if possible.
   *
   * If an implementation does not support an empty value, they MUST set the
   * "Programmed" condition in status to False with a reason of "AddressNotAssigned".
   *
   * Examples: `1.2.3.4`, `128::1`, `my-ip-address`.
   */
  value?: string;
}
