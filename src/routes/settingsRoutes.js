const router = require('express').Router();
const settings = require('../controllers/settingsController');
const wrap = require('../middleware/asyncHandler');

router.get('/', wrap(settings.index));
router.post('/', wrap(settings.save));

module.exports = router;
