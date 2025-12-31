document.addEventListener('DOMContentLoaded', () => {
    const openBtn = document.getElementById('openBtn');
    const fileInput = document.getElementById('fileInput');
    const tabsContainer = document.getElementById('tabsContainer');
    const contentArea = document.getElementById('contentArea');
    const emptyState = document.getElementById('emptyState');

    let files = []; // Array of { name: string, content: string, path: string (fake) }
    let activeIndex = -1;

    // Initialize Marked
    // marked.use({
    //     gfm: true,
    //     breaks: true
    // });

    // Load session
    restoreSession();

    openBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > 0) {
            selectedFiles.forEach(file => {
                readFile(file);
            });
            // Reset input so same file can be selected again if needed
            fileInput.value = '';
        }
    });

    function readFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const newFile = {
                name: file.name,
                content: content,
                id: Date.now() + Math.random().toString() // Unique ID
            };
            
            // Check if file with same name already exists (simple check)
            const existingIndex = files.findIndex(f => f.name === newFile.name);
            if (existingIndex !== -1) {
                // Update content and switch to it
                files[existingIndex].content = content;
                setActiveTab(existingIndex);
            } else {
                files.push(newFile);
                renderTabs();
                setActiveTab(files.length - 1);
            }
            saveSession();
        };
        reader.readAsText(file);
    }

    function renderTabs() {
        tabsContainer.innerHTML = '';
        files.forEach((file, index) => {
            const tab = document.createElement('div');
            tab.className = `tab ${index === activeIndex ? 'active' : ''}`;
            tab.innerHTML = `
                <span>${file.name}</span>
                <span class="tab-close" data-index="${index}">&times;</span>
            `;
            
            tab.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    setActiveTab(index);
                }
            });

            const closeBtn = tab.querySelector('.tab-close');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(index);
            });

            tabsContainer.appendChild(tab);
        });
    }

    function setActiveTab(index) {
        if (index < 0 || index >= files.length) {
            activeIndex = -1;
            renderTabs();
            showEmptyState();
            return;
        }

        activeIndex = index;
        renderTabs();
        renderContent(files[index].content);
        saveSession();
    }

    function closeTab(index) {
        files.splice(index, 1);
        if (files.length === 0) {
            activeIndex = -1;
        } else if (activeIndex >= index) {
            activeIndex = Math.max(0, activeIndex - 1);
        }
        
        if (files.length > 0) {
            setActiveTab(activeIndex);
        } else {
            renderTabs();
            showEmptyState();
        }
        saveSession();
    }

    function renderContent(markdown) {
        // Hide empty state
        emptyState.style.display = 'none';
        
        // Remove existing markdown body if any
        const existingBody = contentArea.querySelector('.markdown-body');
        if (existingBody) {
            existingBody.remove();
        }

        const markdownBody = document.createElement('div');
        markdownBody.className = 'markdown-body';
        
        // Parse markdown
        markdownBody.innerHTML = marked.parse(markdown);
        
        contentArea.appendChild(markdownBody);

        // Apply syntax highlighting
        markdownBody.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    function showEmptyState() {
        emptyState.style.display = 'flex';
        const existingBody = contentArea.querySelector('.markdown-body');
        if (existingBody) {
            existingBody.remove();
        }
    }

    function saveSession() {
        // We can't save full file paths in browser due to security, 
        // so we'll just save the content and names to localStorage.
        // Limit size to avoid quota errors.
        try {
            const sessionData = {
                files: files,
                activeIndex: activeIndex
            };
            localStorage.setItem('mdViewerSession', JSON.stringify(sessionData));
        } catch (e) {
            console.warn('Session save failed (likely quota exceeded)', e);
        }
    }

    function restoreSession() {
        try {
            const saved = localStorage.getItem('mdViewerSession');
            if (saved) {
                const sessionData = JSON.parse(saved);
                if (sessionData.files && Array.isArray(sessionData.files)) {
                    files = sessionData.files;
                    activeIndex = sessionData.activeIndex;
                    
                    if (files.length > 0) {
                        renderTabs();
                        if (activeIndex >= 0 && activeIndex < files.length) {
                            setActiveTab(activeIndex);
                        } else {
                            setActiveTab(0);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Failed to restore session', e);
        }
    }
});
