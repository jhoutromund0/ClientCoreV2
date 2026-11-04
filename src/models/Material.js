const { randomUUID } = require('crypto');

// Repositório temporário em memória, no mesmo modelo dos clientes.
const materials = [];

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const amount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

class Material {
  static all() {
    return [...materials].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  static find(id) {
    return materials.find((item) => item.id === id) || null;
  }

  static create(data) {
    const measureType = data.measureType === 'comprimento' ? 'comprimento' : 'quantidade';
    const item = {
      id: randomUUID(),
      name: text(data.name),
      measureType,
      measure: amount(data.measure),
      unit: measureType === 'comprimento' ? (data.unit === 'kg' ? 'kg' : 'm') : 'un',
      unitValue: amount(data.unitValue),
      updatedAt: new Date().toISOString()
    };
    materials.push(item);
    return item;
  }

  static update(id, data) {
    const item = this.find(id);
    if (!item) return null;
    const measureType = data.measureType === 'comprimento' ? 'comprimento' : 'quantidade';
    Object.assign(item, {
      name: text(data.name),
      measureType,
      measure: amount(data.measure),
      unit: measureType === 'comprimento' ? (data.unit === 'kg' ? 'kg' : 'm') : 'un',
      unitValue: amount(data.unitValue),
      updatedAt: new Date().toISOString()
    });
    return item;
  }

  static delete(id) {
    const index = materials.findIndex((item) => item.id === id);
    if (index < 0) return false;
    materials.splice(index, 1);
    return true;
  }
}

module.exports = Material;
