import { classicIsnetLayout, layoutToXslt } from "../../../frontend/src/utils/einvoiceDesignLayout.js";

const kind = process.argv[2] || "e_invoice";
process.stdout.write(layoutToXslt(classicIsnetLayout(kind), kind));
