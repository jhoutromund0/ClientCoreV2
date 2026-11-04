const { randomUUID } = require('crypto');

// Repositório temporário em memória, no mesmo modelo dos clientes.
const visits = [];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

class Visit {
  static all() {
    return [...visits].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.clientName.localeCompare(b.clientName, 'pt-BR'));
  }

  static find(id) {
    return visits.find((visit) => visit.id === id) || null;
  }

  static create(data) {
    const now = new Date().toISOString();
    const visit = {
      id: randomUUID(),
      clientId: text(data.clientId),
      clientName: text(data.clientName),
      description: text(data.description),
      materials: text(data.materials),
      technicians: text(data.technicians),
      scheduledAt: text(data.scheduledAt),
      createdAt: now,
      updatedAt: now
    };
    visits.push(visit);
    return visit;
  }

  static update(id, data) {
    const visit = this.find(id);
    if (!visit) return null;
    Object.assign(visit, {
      clientId: text(data.clientId),
      clientName: text(data.clientName),
      description: text(data.description),
      materials: text(data.materials),
      technicians: text(data.technicians),
      scheduledAt: text(data.scheduledAt),
      updatedAt: new Date().toISOString()
    });
    return visit;
  }

  static delete(id) {
    const index = visits.findIndex((visit) => visit.id === id);
    if (index < 0) return false;
    visits.splice(index, 1);
    return true;
  }
}

module.exports = Visit;
