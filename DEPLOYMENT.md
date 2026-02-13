# Deployment Guide

## Prerequisites
- GitHub account
- Railway account (railway.app)
- Vercel account (vercel.com)

## Step 1: Deploy Backend Services to Railway

You need to create **2 separate services** on Railway from the same repository:

### Service 1: Solver Backend

1. Go to Railway dashboard → New Project → "Deploy from GitHub repo"
2. Select your `bananagrams-assistant` repository
3. **Configure Service**:
   - Go to Service Settings
   - Under "Build", set **Dockerfile Path** to: `Dockerfile.solver`
   - Keep Root Directory empty (use repo root)
   - Port 8080 will be automatically exposed
4. Deploy and wait for build to complete (~2-3 minutes)
5. Copy the public URL from the Settings → Networking tab
   - Example: `https://solver-production-abc123.up.railway.app`

### Service 2: Segmentation Backend

1. In the same Railway project, click "+ New Service"
2. Select the same repository again
3. **Configure Service**:
   - Go to Service Settings  
   - Under "Build", set **Dockerfile Path** to: `Dockerfile.segmentation`
   - Keep Root Directory empty (use repo root)
   - Port 8081 will be automatically exposed
4. Deploy and wait for build to complete (~5-10 minutes, as it downloads the ML model)
5. Copy the public URL from the Settings → Networking tab
   - Example: `https://segmentation-production-xyz789.up.railway.app`

**Note**: The segmentation service may take longer on first deployment due to the YOLO model download.

## Step 2: Deploy Frontend to Vercel

1. Go to Vercel dashboard → Add New Project
2. Import your `bananagrams-assistant` repository
3. Configure project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Next.js (auto-detected)
4. **Add Environment Variables**:
   - `NEXT_PUBLIC_SOLVER_SERVER_URL` = `https://solver-production-abc123.up.railway.app` (your Railway solver URL)
   - `NEXT_PUBLIC_DETECTION_SERVER_URL` = `https://segmentation-production-xyz789.up.railway.app` (your Railway segmentation URL)
5. Click "Deploy"

## Step 3: Test Your Deployment

1. Visit your Vercel URL (e.g., `https://bananagrams-assistant.vercel.app`)
2. Try the manual input feature first (doesn't require camera)
3. On mobile with HTTPS, camera access should now work!

## Troubleshooting

### Railway Build Fails

**Solver service**:
- Check that `backend/solver` is set as Root Directory
- Verify wordlist.txt exists in `backend/wordlist-parser/`

**Segmentation service**:
- Check that `backend/segmentation` is set as Root Directory
- Verify model file exists: `image-segmentation/models/yolo11x-seg-200epochs-100images.onnx`
- If model file is too large (>500MB), Railway might fail. Consider using Git LFS.

### Frontend Can't Connect to Backend

- Verify environment variables in Vercel are set correctly
- Make sure Railway URLs start with `https://` (not `http://`)
- Check Railway service logs for errors

### Camera Still Doesn't Work

- Verify you're accessing the site via `https://` (Vercel always uses HTTPS)
- Check browser console for permission errors
- Try on a different browser/device

## Cost Estimates

- **Vercel**: Free tier (unlimited for personal projects)
- **Railway**: ~$5-10/month depending on usage
  - Free trial credits available
  - Services sleep after inactivity on free tier
  - Consider Hetzner ($3.50/month) if costs get high

## Local Development

The app still works locally without changes:
- Backend servers run on localhost:8080 and localhost:8081
- Frontend auto-detects and uses localhost
- No environment variables needed for local dev

## Quick Reference

**Dockerfiles**:
- `Dockerfile.solver` - C++ solver service
- `Dockerfile.segmentation` - Python YOLO segmentation service
- `frontend/` - Next.js app (Vercel auto-detects)

**Required files for deployment**:
- ✅ Solver: source files + wordlist.txt
- ✅ Segmentation: Python server + ONNX model (~500MB)
- ✅ Frontend: Next.js app + env variables

**Ports**:
- Solver: 8080
- Segmentation: 8081
- Frontend: 3000 (local) / 80/443 (Vercel)
