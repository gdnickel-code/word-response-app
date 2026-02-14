const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());

/* ---------- HOMEPAGE ---------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));

/* ---------- DATABASE ---------- */
const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      createdAt INTEGER,
      expiresAt INTEGER,
      status TEXT,
      responses TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT,
      name TEXT,
      response TEXT,
      submittedAt INTEGER
    )
  `);
});

function createEmptyResponses() {
  return JSON.stringify(Array(30).fill(""));
}

/* ---------- ORIGINAL SINGLE USER SYSTEM ---------- */

app.post("/create", (req, res) => {
  const id = uuidv4();
  const now = Date.now();
  const expires = now + 30 * 24 * 60 * 60 * 1000;

  db.run(
    `INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`,
    [id, now, expires, "draft", createEmptyResponses()]
  );

  res.json({ id });
});

app.get("/session/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "session.html"));
});

app.get("/data/:id", (req, res) => {
  db.get(`SELECT * FROM sessions WHERE id = ?`, [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });
});

app.post("/save/:id", (req, res) => {
  db.run(
    `UPDATE sessions SET responses = ? WHERE id = ?`,
    [JSON.stringify(req.body.responses), req.params.id]
  );
  res.json({ success: true });
});

app.get("/submit/:id", (req, res) => {
  db.get(`SELECT * FROM sessions WHERE id = ?`, [req.params.id], (err, row) => {
    if (!row) return res.send("Not found");

    const responses = JSON.parse(row.responses);

    if (!fs.existsSync("pdfs")) fs.mkdirSync("pdfs");

    const filePath = path.join(__dirname, "pdfs", `${req.params.id}.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(18).text("Responses", { align: "center" });
    doc.moveDown();

    responses.forEach((r, i) => {
      doc.fontSize(14).text(`Response ${i + 1}`);
      doc.moveDown(0.5);
      doc.fontSize(12).text(r || "(No response)");
      doc.moveDown();
      doc.text("---------------------------------------------");
      doc.moveDown();
    });

    doc.end();

    stream.on("finish", () => {
      res.download(filePath, "session.pdf");
    });
  });
});

/* ---------- SHARED ASSIGNMENT SYSTEM ---------- */

app.get("/a/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assignment.html"));
});

app.post("/submit-response/:id", (req, res) => {
  const { name, response } = req.body;

  if (!name || !response)
    return res.status(400).json({ error: "Missing fields" });

  db.get(
    `SELECT * FROM assignments WHERE id = ? AND LOWER(name) = LOWER(?)`,
    [req.params.id, name],
    (err, row) => {
      if (row)
        return res.status(409).json({ error: "You already submitted" });

      db.run(
        `INSERT INTO assignments VALUES (?, ?, ?, ?)`,
        [req.params.id, name.trim(), response.trim(), Date.now()]
      );

      res.json({ success: true });
    }
  );
});

/* ---------- COMBINED PDF ---------- */

app.get("/download/:id", (req, res) => {
  db.all(`SELECT * FROM assignments WHERE id = ?`, [req.params.id], (err, rows) => {

    if (err) {
      console.error(err);
      return res.status(500).send("Database error");
    }

    if (!rows || rows.length === 0)
      return res.send("No responses yet");

    rows.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
    );

    if (!fs.existsSync("pdfs")) fs.mkdirSync("pdfs");

    const filePath = path.join(__dirname, "pdfs", `class-${req.params.id}.pdf`);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).text("Class Responses", { align: "center" });
    doc.moveDown(2);

    rows.forEach((r, index) => {
      const date = new Date(r.submittedAt).toLocaleString();

      doc.fontSize(14).text(r.name || "Unnamed", { underline: true });
      doc.fontSize(10).fillColor("gray").text(date);
      doc.fillColor("black");
      doc.moveDown(0.5);

      doc.fontSize(12).text(r.response || "");

      if (index !== rows.length - 1) {
        doc.moveDown();
        doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();
      }

      if (doc.y > 700) doc.addPage();
    });

    doc.end();

    stream.on("finish", () => {
      res.download(filePath);
    });
  });
});

/* ---------- START SERVER ---------- */

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
