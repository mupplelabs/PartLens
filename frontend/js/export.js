// =====================================================================
// EXPORT FORMAT CONTROLLER (YOLO & COCO)
// Supports Desktop Dropdowns & Mobile Action Sheet
// =====================================================================

(function initExportSystem() {
    const exportSheet = document.getElementById('export-action-sheet');
    const closeBtn = document.getElementById('btn-close-export-sheet');
    const cancelBtn = document.getElementById('btn-cancel-export-sheet');

    function openExportSheet() {
        if (!exportSheet) return;
        exportSheet.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeExportSheet() {
        if (!exportSheet) return;
        exportSheet.style.display = 'none';
        document.body.style.overflow = '';
    }

    window.openExportSheet = openExportSheet;
    window.closeExportSheet = closeExportSheet;

    if (closeBtn) closeBtn.addEventListener('click', closeExportSheet);
    if (cancelBtn) cancelBtn.addEventListener('click', closeExportSheet);

    if (exportSheet) {
        exportSheet.addEventListener('click', (e) => {
            if (e.target === exportSheet) closeExportSheet();
        });

        // Klick auf eine Export-Option schließt das Sheet nach kurzem Delay
        exportSheet.querySelectorAll('.export-format-card').forEach(card => {
            card.addEventListener('click', () => {
                setTimeout(closeExportSheet, 300);
            });
        });
    }

    // Dropdowns für Desktop (oder Fallback auf Sheet bei schmalen Screens)
    function setupDropdown(btnId, menuId) {
        const btn = document.getElementById(btnId);
        const menu = document.getElementById(menuId);
        if (!btn) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Auf mobilen Bildschirmen immer das saubere Action-Sheet öffnen (keine Clipping-Probleme)
            if (window.innerWidth <= 768) {
                openExportSheet();
                return;
            }

            if (!menu) return;
            const isOpen = menu.style.display === 'block';
            document.querySelectorAll('.export-dropdown-menu').forEach(m => {
                m.style.display = 'none';
            });
            menu.style.display = isOpen ? 'none' : 'block';
        });

        if (menu) {
            menu.querySelectorAll('.export-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    menu.style.display = 'none';
                });
            });
        }
    }

    setupDropdown('export-yolo-btn-top', 'export-dropdown-menu-top');
    setupDropdown('export-dataset-btn-gallery', 'export-dropdown-menu-gallery');

    document.addEventListener('click', () => {
        document.querySelectorAll('.export-dropdown-menu').forEach(m => {
            m.style.display = 'none';
        });
    });
})();
