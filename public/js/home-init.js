// Initialize mermaid with better rendering options
if (window.mermaid) {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        classMaxWidth: 200,
        flowchart: {
            useMaxWidth: true,
            padding: 20
        },
        classDiagram: {
            useMaxWidth: true,
            padding: 20
        }
    });
}
