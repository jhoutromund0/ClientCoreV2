const { randomUUID } = require('crypto');

// Repositório temporário em memória para a interface funcionar antes do MySQL.
// Os dados são perdidos ao reiniciar o servidor. Substituir por persistência MySQL depois.
const clients = [];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

class Client {
  static all() { return [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
  static find(id) { return clients.find(client => client.id === id) || null; }
  static create(data) {
    const client = { id: randomUUID(), name: text(data.name), cnpj: text(data.cnpj), email: text(data.email), phone: text(data.phone), company: text(data.company), createdAt: new Date().toISOString() };
    clients.push(client);
    return client;
  }
  static update(id, data) {
    const client = this.find(id);
    if (!client) return null;
    Object.assign(client, { name: text(data.name), cnpj: text(data.cnpj), email: text(data.email), phone: text(data.phone), company: text(data.company) });
    return client;
  }
  static delete(id) { const index = clients.findIndex(client => client.id === id); if (index < 0) return false; clients.splice(index, 1); return true; }
}
module.exports = Client;
