# A Refunded Purchase is derived from its Approved Refund, not stored on the Purchase

A Purchase is a Refunded Purchase exactly when it has an Approved Refund Request; there is no refunded flag or status on the Purchase itself. Keeping the fact in one place means the two can never disagree, and the Refund Request already records who decided, when, and the Refund Amount.
