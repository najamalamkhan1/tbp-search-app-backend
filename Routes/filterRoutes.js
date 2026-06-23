const express = require("express");
const router = express.Router();
const filterController = require("../controllers/filterController");

router.post("/filters/reorder", filterController.reorderFilters);
router.post("/filters/bulk-delete", filterController.bulkDelete);
router.post("/filters/bulk-status", filterController.bulkStatus);

router.post("/filters", filterController.createFilter);
router.get("/filters", filterController.getFilters);
router.get("/filters/options", filterController.getFilterOptions);
router.get("/filters/:id", filterController.getFilter);
router.put("/filters/:id", filterController.updateFilter);
router.delete("/filters/:id", filterController.deleteFilter);
router.patch("/filters/:id/status", filterController.toggleStatus);
router.patch("/filters/:id/visibility", filterController.toggleVisibility);

module.exports = router;
