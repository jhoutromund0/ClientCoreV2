const { randomUUID } = require('crypto');

// Repositório temporário em memória para a interface funcionar antes do MySQL.
// Os dados são perdidos ao reiniciar o servidor. Substituir por persistência MySQL depois.
const clients = [];

class Client {
  static all() { return [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
  static find(id) { return clients.find(client => client.id === id) || null; }
  static create(data) {
    const client = { id: randomUUID(), name: data.name.trim(), cnpj: (data.cnpj || '').trim(), email: (data.email || '').trim(), phone: (data.phone || '').trim(), company: (data.company || '').trim(), createdAt: new Date().toISOString() };
    clients.push(client);
    return client;
  }
  static update(id, data) {
    const client = this.find(id);
    if (!client) return null;
    Object.assign(client, { name: data.name.trim(), cnpj: (data.cnpj || '').trim(), email: (data.email || '').trim(), phone: (data.phone || '').trim(), company: (data.company || '').trim() });
    return client;
  }
  static delete(id) { const index = clients.findIndex(client => client.id === id); if (index < 0) return false; clients.splice(index, 1); return true; }
}
module.exports = Client;
