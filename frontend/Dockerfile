FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
# Private visual-edits tarball is optional; CRA/craco already degrades without it.
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); if(p.devDependencies) delete p.devDependencies['@emergentbase/visual-edits']; fs.writeFileSync('package.json', JSON.stringify(p,null,2));"

RUN yarn install --network-timeout 600000

COPY . .
ARG REACT_APP_BACKEND_URL=
ARG GIT_SHA=
ARG GIT_BRANCH=
ARG GIT_MESSAGE=
ARG BUILD_TIME=
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL \
    REACT_APP_GIT_SHA=$GIT_SHA \
    REACT_APP_GIT_BRANCH=$GIT_BRANCH \
    REACT_APP_GIT_MESSAGE="$GIT_MESSAGE" \
    REACT_APP_BUILD_TIME=$BUILD_TIME \
    DISABLE_ESLINT_PLUGIN=true \
    CI=false \
    GENERATE_SOURCEMAP=false

RUN yarn build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
