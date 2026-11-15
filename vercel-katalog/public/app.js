const CSV_URL = "./data/products.csv";
const tbody = document.getElementById("productsBody");
const status = document.getElementById("status");

function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");

    const firstLine = text.split(/\r?\n/, 1)[0];
    const delimiter =
        (firstLine.match(/;/g) || []).length >
            (firstLine.match(/,/g) || []).length
            ? ";"
            : ",";

    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const character = text[i];

        if (character === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (character === delimiter && !quoted) {
            row.push(cell);
            cell = "";
        } else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && text[i + 1] === "\n") i++;
            row.push(cell);
            if (row.some(value => value.trim())) rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += character;
        }
    }

    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);

    if (rows.length < 2) return [];

    const headers = rows.shift().map(header => header.trim().toLowerCase());
    return rows.map(values => {
        const product = {};
        headers.forEach((header, index) => {
            product[header] = (values[index] || "").trim();
        });
        return product;
    });
}

function getField(product, names) {
    for (const name of names) {
        if (product[name]) return product[name];
    }
    return "";
}

function validShopeeLink(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();

        if (
            url.protocol === "https:" &&
            (host === "shopee.co.id" || host.endsWith(".shopee.co.id"))
        ) {
            return url.href;
        }
    } catch {
        return "";
    }

    return "";
}

function addCell(row, text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
}

function showProducts(rows) {
    const products = rows.map(row => ({
        nama: getField(row, [
            "nama produk",
            "nama_produk",
            "nama",
            "product",
            "product name",
            "name",
            "title"
        ]),
        kategori: getField(row, ["kategori", "category"]) || "Lainnya",
        harga: getField(row, ["harga", "price"]),
        link: getField(row, [
            "link shopee",
            "link_shopee",
            "link",
            "url"
        ])
    })).filter(product => product.nama);

    if (!products.length) {
        throw new Error("Data produk kosong atau header CSV tidak dikenali.");
    }

    const productRows = products.map((product, index) => {
        const row = document.createElement("tr");
        addCell(row, String(index + 1));
        addCell(row, product.nama);
        addCell(row, product.kategori);
        addCell(row, product.harga || "-", "price");

        const linkCell = addCell(row, "");
        const productUrl = validShopeeLink(product.link);
        if (productUrl) {
            const link = document.createElement("a");
            link.href = productUrl;
            link.textContent = "Lihat Produk";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "shopee-link";
            linkCell.appendChild(link);
        } else {
            linkCell.textContent = "-";
        }

        return row;
    });

    tbody.replaceChildren(...productRows);
    status.textContent = `${products.length} produk berhasil dimuat`;
}

async function loadProducts() {
    try {
        const response = await fetch(CSV_URL);
        if (!response.ok) {
            throw new Error(`CSV tidak ditemukan (HTTP ${response.status}).`);
        }

        const rows = parseCSV(await response.text());
        showProducts(rows);
    } catch (error) {
        console.error("Gagal memuat katalog:", error);
        status.textContent = `Gagal memuat katalog: ${error.message}`;
        tbody.replaceChildren();

        const row = document.createElement("tr");
        addCell(row, "Data katalog tidak tersedia.").colSpan = 5;
        tbody.appendChild(row);
    }
}

loadProducts();
