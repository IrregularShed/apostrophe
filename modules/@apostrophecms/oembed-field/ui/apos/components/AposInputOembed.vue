<template>
  <AposInputWrapper
    :modifiers="modifiers" :field="field"
    :error="effectiveError" :uid="uid"
    :display-options="displayOptions"
  >
    <template #body>
      <div class="apos-input-wrapper">
        <input
          :class="classes"
          v-model="next.url" type="url"
          :placeholder="field.placeholder"
          :disabled="field.readOnly" :required="field.required"
          :id="uid" :tabindex="tabindex"
        >
        <component
          v-if="icon"
          :size="iconSize"
          class="apos-input-icon"
          :is="icon"
        />
        <div
          v-if="!error && oembedResult.html" v-html="oembedResult.html"
          class="apos-input__embed" :class="{ 'apos-is-dynamic': !!dynamicRatio }"
          :style="{ paddingTop: dynamicRatio && `${(dynamicRatio * 100)}%` }"
        />
      </div>
    </template>
  </AposInputWrapper>
</template>

<script>
import AposInputMixin from 'Modules/@apostrophecms/schema/mixins/AposInputMixin';

export default {
  name: 'AposInputOembed',
  mixins: [ AposInputMixin ],
  emits: [ 'return' ],
  data () {
    return {
      next: (this.value && this.value.data !== undefined)
        ? this.value.data : {},
      oembedResult: {},
      dynamicRatio: '',
      oembedError: null
    };
  },
  computed: {
    tabindex () {
      return this.field.disableFocus ? '-1' : '0';
    },
    classes () {
      return [ 'apos-input', 'apos-input--oembed' ];
    },
    icon () {
      if (this.error) {
        return 'circle-medium-icon';
      } else {
        return null;
      }
    }
  },
  async mounted() {
    if (this.next && this.next.url) {
      await this.loadOembed();
    }
  },
  methods: {
    validate(value) {
      if (value == null || value.url === null) {
        value = {};
      }

      if (
        this.field.oembedType && this.oembedResult.type &&
        this.oembedResult.type !== this.field.oembedType
      ) {
        return { message: 'Embed type not supported' };
      } else if (this.oembedError) {
        return this.oembedError.message ? {
          message: this.oembedError.message
        } : 'invalid';
      }

      if (this.field.required) {
        if (!value || !value.url) {
          return 'required';
        }
      }
      return false;
    },
    async watchNext () {
      await this.loadOembed();

      this.validateAndEmit();
    },
    async loadOembed () {
      this.field.readOnly = true;
      this.oembedResult = {};
      this.oembedError = null;
      this.dynamicRatio = '';

      try {
        const result = await apos.http.get(`${apos.oembed.action}/query`, {
          busy: true,
          qs: {
            url: this.next.url
          }
        });
        this.next.title = result.title || '';
        this.next.thumbnail = result.thumbnail_url || '';
        this.oembedResult = result;

        if (typeof result.height === 'number' && typeof result.width === 'number') {
          this.dynamicRatio = (result.height / result.width);
        }
      } catch (error) {
        if (error.body && error.body.message) {
          this.oembedError = error.body;
        } else {
          this.oembedError = { message: 'Invalid embed URL' };
        }
        this.next.title = '';
        this.next.thumbnail = '';
      } finally {
        this.field.readOnly = false;
      }
    }
  }
};
</script>

<style lang="scss" scoped>
  .apos-input--oembed {
    margin-bottom: $spacing-double;
  }
  .apos-input__embed {
    ::v-deep iframe {
      max-width: 100%;
    }

    &.apos-is-dynamic {
      position: relative;
      width: 100%;
      height: 0;

      ::v-deep iframe {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }
    }
  }
</style>
