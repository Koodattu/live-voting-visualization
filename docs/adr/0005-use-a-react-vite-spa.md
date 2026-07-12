# Use a React and Vite single-page application

The browser interface is a React and Vite single-page application using React Router and served as static assets by the same Node process that owns the API and real-time connections. The product's public, participant, presentation, and admin surfaces are highly interactive and gain little from server-side rendering, so this favors a clear client-server boundary and one deployment over a full-stack rendering framework.
