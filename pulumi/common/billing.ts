interface BillingOpts {
  product?: string | null;
  stage?: string | null;
  deployment?: string | null;
}

export function billingTags(opts: BillingOpts): { [key: string]: string } {
  const tags: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value) {
      tags[`billing.${key}`] = value;
    }
  }
  return tags;
}
