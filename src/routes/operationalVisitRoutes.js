const router = require('express').Router();
const wrap = require('../middleware/asyncHandler');
const visits = require('../controllers/visitController');

router.get('/', wrap(visits.operationalIndex));
router.get('/:id', wrap(visits.operationalDetail));

module.exports = router;
