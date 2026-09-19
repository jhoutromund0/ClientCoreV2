const express = require('express');
const path = require('path');

const app = express();

    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.get("/", (req, res) => {
        res.render('system');
    });
    app.listen(3000, () => {
        console.log('Servidor rodando na porta 3000');
    });