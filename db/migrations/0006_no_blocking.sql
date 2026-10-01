-- Blocking was removed from the product: clear any leftover flags.
UPDATE contacts SET blocked = 0 WHERE blocked != 0;
