ARG WDCLAW_FULL_RUNTIME_IMAGE
ARG APT_MIRROR=http://repo.huaweicloud.com/ubuntu/
ARG APT_FALLBACK_MIRROR=http://mirrors.aliyun.com/ubuntu/
ARG PIP_INDEX_URL=https://repo.huaweicloud.com/repository/pypi/simple/
ARG PIP_EXTRA_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

FROM ${WDCLAW_FULL_RUNTIME_IMAGE}
ARG APT_MIRROR
ARG APT_FALLBACK_MIRROR
ARG PIP_INDEX_URL
ARG PIP_EXTRA_INDEX_URL

USER 0:0
RUN rm -rf /agent
COPY agents/design-inspiration/ /agent/
COPY shared/worker-sdk/ /agent/shared/worker-sdk/
ENV PYTHONPATH=/agent/shared/worker-sdk \
  PIP_INDEX_URL=${PIP_INDEX_URL} \
  PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL}
RUN chmod +x /agent/worker/worker.py

WORKDIR /workspace
CMD ["python3", "/agent/worker/worker.py"]
