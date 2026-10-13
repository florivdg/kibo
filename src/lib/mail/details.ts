// A line of facts under the introduction of a mail: what an invoice request
// names. A module of its own, without a dependency, because the operator's
// script prints the same lines (scripts/admin/invoice.ts) and must not load
// the templates, which read the instance's configuration.
export interface MailDetail {
  label: string
  // May run over several lines (an address)
  value: string
  // A web address, which the HTML version makes a link
  link?: true
}

// "Label: Wert", a value of several lines indented under its label
export function detailText({ label, value }: MailDetail) {
  const lines = value.split(/\r?\n/)
  return lines.length === 1
    ? `${label}: ${value}`
    : `${label}:\n${lines.map((line) => `  ${line}`).join('\n')}`
}
