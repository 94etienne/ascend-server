require("dotenv").config();

const mysql = require("mysql2");

const connection = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT
});

connection.connect((err) => {
    if (err) {
        console.error("❌ MySQL Connection Failed:", err.message);
        return;
    }

    console.log("✅ Connected to MySQL Database");
});

module.exports = connection;