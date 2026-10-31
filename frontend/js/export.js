// =====================================================================
// EXPORT FORMAT DROPDOWN CONTROLLER (YOLO & COCO)
// =====================================================================

// =====================================================================
// EXPORT FORMAT DROPDOWN CONTROLLER (YOLO & COCO)
// =====================================================================
(function initExportDropdowns() {
    function setupDropdown(btnId, menuId) {
        const btn = document.getElementById(btnId);
        const menu = document.getElementById(menuId);
        if (!btn || !menu) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            document.querySelectorAll('.export-dropdown-menu').forEach(m => {
                m.style.display = 'none';
            });
            menu.style.display = isOpen ? 'none' : 'block';
        });

        menu.querySelectorAll('.export-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                menu.style.display = 'none';
            });
        });
    }

    setupDropdown('export-yolo-btn-top', 'export-dropdown-menu-top');
    setupDropdown('export-dataset-btn-gallery', 'export-dropdown-menu-gallery');

    document.addEventListener('click', () => {
        document.querySelectorAll('.export-dropdown-menu').forEach(m => {
            m.style.display = 'none';
        });
    });
})();

