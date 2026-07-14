"use client";

import { useState } from "react";

// Monthly-medicine checkbox that reveals an invoice-number field when ticked.
export function MonthlyField({
  defaultChecked = false,
  defaultInvoice = "",
}: {
  defaultChecked?: boolean;
  defaultInvoice?: string;
}) {
  const [monthly, setMonthly] = useState(defaultChecked);
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          name="monthly_medicine"
          checked={monthly}
          onChange={(e) => setMonthly(e.target.checked)}
        />
        <span>Monthly medicine customer</span>
      </label>
      {monthly ? (
        <>
          <label htmlFor="monthly_invoice_no">Invoice number</label>
          <input
            id="monthly_invoice_no"
            name="monthly_invoice_no"
            type="text"
            defaultValue={defaultInvoice}
            placeholder="e.g. INV-2026-0142"
          />
        </>
      ) : null}
    </>
  );
}
