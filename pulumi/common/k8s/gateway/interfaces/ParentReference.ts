import type { Input } from '@pulumi/pulumi';

/**
 * ParentReference identifies an API object (usually a Gateway)
 * that can be considered a parent of this resource (usually a route).
 *
 * There are two kinds of parent resources with "*Core*" support:
 *
 * - Gateway (Gateway conformance profile)
 * - Service (Mesh conformance profile, ClusterIP Services only)
 *
 * This API may be extended in the future to support additional kinds
 * of parent resources.
 *
 * The API object must be valid in the cluster; the Group and Kind must
 * be registered in the cluster for this reference to be valid.
 */
export interface ParentReference {
  /**
   * Group of the referent.
   *
   * When unspecified, `gateway.networking.k8s.io` is inferred.
   *
   * To set the core API group (such as for a `Service` kind referent),
   * `group` must be explicitly set to `""` (empty string).
   *
   * _Support: Core_
   */
  group?: Input<string>;

  /**
   * Kind of the referent.
   *
   * There are two kinds of parent resources with "*Core*" support:
   * - Gateway (Gateway conformance profile)
   * - Service (Mesh conformance profile, ClusterIP Services only)
   *
   * Support for other resources is Implementation-Specific.
   */
  kind: Input<string>;

  /**
   * Namespace of the referent.
   *
   * When unspecified, this refers to the local namespace of the Route.
   *
   * Note that there are specific rules for ParentRefs which cross namespace
   * boundaries. Cross-namespace references are only valid if they are explicitly
   * allowed by something in the namespace they are referring to. For example:
   * Gateway has the AllowedRoutes field, and ReferenceGrant provides a
   * generic way to enable any other kind of cross-namespace reference.
   *
   * ParentRefs from a Route to a Service in the same namespace are "producer"
   * routes, which apply default routing rules to inbound connections from
   * any namespace to the Service.
   *
   * ParentRefs from a Route to a Service in a different namespace are
   * "consumer" routes, and these routing rules are only applied to outbound
   * connections originating from the same namespace as the Route, for which
   * the intended destination of the connections are a Service targeted as a
   * ParentRef of the Route.
   *
   * _Support: Core_
   */
  namespace?: Input<string>;

  /**
   * Name of the referent.
   *
   * _Support: Core_
   */
  name: Input<string>;

  /**
   * SectionName is the name of a section within the target resource.
   *
   * In the following resources, SectionName is interpreted as the following:
   * - Gateway: Listener name. When both Port (experimental) and SectionName
   *   are specified, the name and port of the selected listener must match
   *   both specified values.
   * - Service: Port name. When both Port (experimental) and SectionName
   *   are specified, the name and port of the selected listener must match
   *   both specified values.
   *
   * Implementations MAY choose to support attaching Routes to other resources.
   * If that is the case, they MUST clearly document how SectionName is
   * interpreted.
   *
   * When unspecified or the empty string, this will reference the entire resource.
   *
   * For the purpose of status, an attachment is considered successful if at
   * least one section in the parent resource accepts it. For example, Gateway
   * listeners can restrict which Routes can attach to them by Route kind,
   * namespace, or hostname. If 1 of 2 Gateway listeners accept attachment from
   * the referencing Route, the Route MUST be considered successfully
   * attached. If no Gateway listeners accept attachment from this Route, the
   * Route MUST be considered detached from the Gateway.
   *
   * _Support: Core_
   */
  sectionName?: Input<string>;

  /**
   * Port is the network port this Route targets. It can be interpreted
   * differently based on the type of parent resource.
   *
   * When the parent resource is a Gateway, this targets all listeners
   * listening on the specified port that also support this kind of Route(and
   * select this Route). It's not recommended to set Port unless the
   * networking behaviors specified in a Route must apply to a specific port
   * as opposed to a listener(s) whose port(s) may be changed. When both Port
   * and SectionName are specified, the name and port of the selected listener
   * must match both specified values.
   *
   * When the parent resource is a Service, this targets a specific port in the
   * Service spec. When both Port (*experimental*) and SectionName are specified,
   * the name and port of the selected port must match both specified values.
   *
   * Implementations MAY choose to support other parent resources.
   *
   * Implementations supporting other types of parent resources MUST clearly
   * document how/if Port is interpreted.
   *
   * For the purpose of status, an attachment is considered successful as
   * long as the parent resource accepts it partially. For example, Gateway
   * listeners can restrict which Routes can attach to them by Route kind,
   * namespace, or hostname. If 1 of 2 Gateway listeners accept attachment
   * from the referencing Route, the Route MUST be considered successfully
   * attached. If no Gateway listeners accept attachment from this Route,
   * the Route MUST be considered detached from the Gateway.
   *
   * _Support: Extended_
   */
  port?: Input<number>;
}
