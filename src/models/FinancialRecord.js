// Repositório em memória, como os modelos de visitas e materiais.
const records = new Map();

class FinancialRecord {
  static find(visitId) {
    return records.get(visitId);
  }

  static save(visitId, data) {
    records.set(visitId, data);
  }

  static delete(visitId) {
    records.delete(visitId);
  }
}

module.exports = FinancialRecord;
