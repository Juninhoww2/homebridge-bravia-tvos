'use strict';

const Logger = require('../helper/logger.js');
const fs = require('fs-extra');

const TIMEOUT = (ms) => new Promise((res) => setTimeout(res, ms)); 

class tvAccessory {

  constructor (api, accessory, accessories, bravia) {

    this.api = api;
    this.accessory = accessory;
    this.accessories = accessories;
    this.bravia = bravia;
    this.fileName = accessory.displayName.replace(/\s+/g, '_') + '-inputs.json';
    
    this.inputs = new Map();
    this.apps = new Map();
    this.channels = new Map();
    this.commands = new Map();
    
    this.getService(this.accessory);

  }

  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~//
  // Services
  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~//

  async getService (accessory) {
  
    accessory.category = this.api.hap.Categories.TELEVISION;
    
    let service = accessory.getService(this.api.hap.Service.Television);
    let speakerService = accessory.getService(this.api.hap.Service.TelevisionSpeaker);
    
    if(!service) {
      Logger.debug('Adding tv service', accessory.displayName);
      service = accessory.addService(this.api.hap.Service.Television, this.accessory.displayName, 'tv');
      service
        .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, accessory.displayName)
        .setCharacteristic(this.api.hap.Characteristic.SleepDiscoveryMode, this.api.hap.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    }
    
    if(!speakerService){
      Logger.debug('Adding speaker service', accessory.displayName);
      speakerService = accessory.addService(this.api.hap.Service.TelevisionSpeaker, this.accessory.displayName);
      speakerService
        .setCharacteristic(this.api.hap.Characteristic.Active, this.api.hap.Characteristic.Active.ACTIVE)
        .setCharacteristic(this.api.hap.Characteristic.VolumeControlType, this.api.hap.Characteristic.VolumeControlType.ABSOLUTE);
    }
      
    service.getCharacteristic(this.api.hap.Characteristic.Active)
      .on('set', this.setPower.bind(this));
      
    service.getCharacteristic(this.api.hap.Characteristic.ActiveIdentifier)
      .on('set', this.setActiveIdentifier.bind(this));
      
    service.getCharacteristic(this.api.hap.Characteristic.RemoteKey)
      .on('set', this.setRemoteKey.bind(this, null));
      
    service.getCharacteristic(this.api.hap.Characteristic.PowerModeSelection)
      .on('set', this.setRemoteKey.bind(this, 'SETTINGS'));
  
    speakerService.getCharacteristic(this.api.hap.Characteristic.VolumeSelector)
      .on('set', this.setVolume.bind(this));
    
    await this.handleInputs();
    
    this.addInputServices(service, this.configureInputs(service));
    this.sortInputServices(this.configureInputs(service));

    this.api.updatePlatformAccessories([this.accessory]);
    
    this.poll();
    
  }
  
  async poll(){
  
    let service, on, volume;
  
    let speakerAccessory = this.accessories.find(accessory => accessory.displayName === (this.accessory.displayName + ' Speaker'));  
  
    if(speakerAccessory){
    
      if(speakerAccessory.getService(this.api.hap.Service.Speaker)){
        service = this.api.hap.Service.Speaker;
        on = this.api.hap.Characteristic.Mute;
        volume = this.api.hap.Characteristic.Volume;
      } else if(speakerAccessory.getService(this.api.hap.Service.Lightbulb)){
        service = this.api.hap.Service.Lightbulb;
        on = this.api.hap.Characteristic.On;
        volume = this.api.hap.Characteristic.Brightness;
      } else {
        service = this.api.hap.Service.Switch;
        on = this.api.hap.Characteristic.On;
        volume = this.api.hap.Characteristic.Volume;
      }
    
    }  
  
    try {
    
      Logger.debug('Polling tv state', this.accessory.displayName);   
      let data = await this.bravia.avContent.invoke('getPlayingContentInfo');
      Logger.debug(data, this.accessory.displayName);
      
      if(data.uri){
        let index = this.getIndex('uri', data.uri) || 0;
        this.accessory
          .getService(this.api.hap.Service.Television)
          .getCharacteristic(this.api.hap.Characteristic.ActiveIdentifier)
          .updateValue(index);
      } else { //application
        this.accessory
          .getService(this.api.hap.Service.Television)
          .getCharacteristic(this.api.hap.Characteristic.ActiveIdentifier)
          .updateValue(0);
      }
      
      this.accessory
        .getService(this.api.hap.Service.Television)
        .getCharacteristic(this.api.hap.Characteristic.Active)
        .updateValue(1);
        
      speakerAccessory = this.accessories.find(accessory => accessory.displayName === this.accessory.displayName + ' Speaker');  
        
      if(speakerAccessory && !speakerAccessory.context.inProgress){
      
        TIMEOUT(750);
      
        Logger.debug('Polling speaker state', this.accessory.displayName); 
        data = await this.bravia.audio.invoke('getVolumeInformation');
        Logger.debug(data, this.accessory.displayName);
        
        let target = this.accessory.context.config.speaker.output === 'other' 
          ? 'speaker' 
          : this.accessory.context.config.speaker.output ;
        
        for(const speaker of data){
        
          if(speaker.target === target){

            speakerAccessory
              .getService(service)
              .getCharacteristic(on)
              .updateValue(on !== this.api.hap.Characteristic.Mute ? !speaker.mute : speaker.mute);
          
            speakerAccessory
              .getService(service)
              .getCharacteristic(volume)
              .updateValue(speaker.volume || 0);
          
          }
        
        }
      
      }  
    
    } catch(err) {
        
      Logger.error('An error occured during polling tv/speaker state', this.accessory.displayName);
      this.handleError(err);
      
    } finally {
    
      setTimeout(() => {
        this.poll();
      }, this.accessory.context.polling);
    
    }
  
  }
  
  async setPower(value, callback){
  
    try {
       
      Logger.info(value ? 'ON' : 'OFF', this.accessory.displayName);
       
      if(!value){
        await this.bravia.sleep();
      } else {
        if(this.accessory.context.config.wol && this.accessory.context.config.mac){
          await this.bravia.wake(this.accessory.context.config.mac, false, true);
        } else {
          await this.bravia.wake();
        }
      } 
     
    } catch(err) {
     
      Logger.error('An error occured during powering ' + (value ? 'on' : 'off') + ' tv!', this.accessory.displayName);
      this.handleError(err);
      
      setTimeout(() => {
        
        this.accessory
          .getService(this.api.hap.Television)
          .getCharacteristic(this.api.hap.Characteristic.Active)
          .updateValue(value ? 1 : 0);
        
      }, 1000);
     
    } finally {
     
      callback(null);
     
    }
  
  }
  
  async setVolume(value, callback){
  
    let tvState = this.accessory.getService(this.api.hap.Service.Television).getCharacteristic(this.api.hap.Characteristic.Active).value;
    
    callback(null); //triggers powering on tv if tv = off
  
    try {
       
      if(!tvState){
        Logger.info('Wait for TV turning on before send command..', this.accessory.displayName);
        await TIMEOUT(2000);
      }
       
      let volumeLevel = value ? -(this.accessory.context.config.speaker.reduceBy) : this.accessory.context.config.speaker.increaseBy;
      Logger.info((value ? 'Reducing' : 'Increasing') + ' volume by ' + volumeLevel, this.accessory.displayName);
       
      let target = this.accessory.context.config.speaker.output;
       
      if(target === 'other'){
        let volumeUp = this.accessory.context.config.remote.VOLUME_UP;
        let volumeDown = this.accessory.context.config.remote.VOLUME_DOWN;
        let cmds = [];
        for(let i = 0; i < (volumeLevel < 0 ? -(volumeLevel) : volumeLevel); i++){
          cmds.push(value ? volumeDown : volumeUp);
        }
        await this.bravia.send(cmds, 350);
      } else {
        try {
          await this.bravia.audio.invoke('setAudioVolume', '1.0', { target: target, volume: volumeLevel < 0 ? volumeLevel.toString() : '+' + volumeLevel.toString() });
        } catch(err) {
          if(!(err instanceof Error) && err.includes(40801)){
            Logger.warn('Can not ' + (value ? 'reduce' : 'increase') + ' volume. Volume Level out of range.', this.accessory.displayName);
          } else {
            throw err;
          }
        }
      }
     
    } catch(err) {
     
      Logger.error('An error occured during ' + (value ? 'decreasing' : 'increasing') + ' volume!', this.accessory.displayName);
      this.handleError(err);
     
    }
  
  }
  
  async setActiveIdentifier(state, callback){
  
    callback(null);
    
    let name = this.fetchedInputs[state].title || this.fetchedInputs[state].label || this.fetchedInputs[state].name;
    
    if(name){
      try {
        switch(this.fetchedInputs[state].type){
          case 'input':
            Logger.info('Changing input source to ' + name + ' (' + this.fetchedInputs[state].uri + ')', this.accessory.displayName);  
            await this.bravia.avContent.invoke('setPlayContent', '1.0', { uri: this.fetchedInputs[state].uri });
            break;
          case 'channel':
            Logger.info('Changing channel to ' + name + ' (' + this.fetchedInputs[state].uri + ')', this.accessory.displayName); 
            await this.bravia.avContent.invoke('setPlayContent', '1.0', { uri: this.fetchedInputs[state].uri });
            break;
          case 'application':
            Logger.info('Changing application to ' + name + ' (' + this.fetchedInputs[state].uri + ')', this.accessory.displayName);  
            await this.bravia.appControl.invoke('setActiveApp', '1.0', { uri: this.fetchedInputs[state].uri });
            break;
          case 'ircc':
            Logger.info('Sending "' + name + '" command (' + this.fetchedInputs[state].value + ')', this.accessory.displayName);
            await this.bravia.send(this.fetchedInputs[state].value);
            break;
          default:
            Logger.warn('Can not change source (' + name + ')', this.accessory.displayName);
            break;
        }
      } catch(err) {
        Logger.error('An error occured during changing source (' + name + ')', this.accessory.displayName);
        this.handleError(err);
      }
    } else {
      Logger.warn('Can not change source. ' + name + ' not found! Try updating inputs and restart homebridge!', this.accessory.displayName);
    }
  
  }
  
  async setRemoteKey(custom, state, callback){
  
    let tvState = this.accessory.getService(this.api.hap.Service.Television).getCharacteristic(this.api.hap.Characteristic.Active).value;
    
    callback(null); //triggers powering on tv if tv = off
    
    try {
    
      if(!tvState && custom === null){
        Logger.info('Wait for TV turning on before send command..', this.accessory.displayName);
        await TIMEOUT(2000);
      }
      
      if(custom !== null)
        state = custom;
    
      switch(state){
    
        case this.api.hap.Characteristic.RemoteKey.REWIND:
          Logger.info('Rewind', this.accessory.displayName); 
          await this.bravia.send(this.accessory.context.config.remote.REWIND);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.FAST_FORWARD:
          Logger.info('Fast Forward', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.FAST_FORWARD);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.NEXT_TRACK:
          Logger.info('Next Track', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.NEXT_TRACK);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.PREVIOUS_TRACK:
          Logger.info('Previous Track', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.PREVIOUS_TRACK);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.ARROW_UP:
          Logger.info('Up', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.ARROW_UP);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.ARROW_DOWN:
          Logger.info('Down', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.ARROW_DOWN);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.ARROW_LEFT:
          Logger.info('Left', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.ARROW_LEFT);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.ARROW_RIGHT:
          Logger.info('Right', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.ARROW_RIGHT);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.SELECT:
          Logger.info('Select', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.SELECT);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.BACK:
          Logger.info('Back', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.BACK);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.EXIT:
          Logger.info('Exit', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.EXIT);
          break;
          
        case this.api.hap.Characteristic.RemoteKey.PLAY_PAUSE:
          if(this.pause){
            this.pause = false;
            Logger.info('Pause', this.accessory.displayName);
            await this.bravia.send(this.accessory.context.config.remote.PAUSE);
          } else {
            this.pause = true;
            Logger.info('Play', this.accessory.displayName);
            await this.bravia.send(this.accessory.context.config.remote.PLAY);
          }
          break;
          
        case this.api.hap.Characteristic.RemoteKey.INFORMATION:
          Logger.info('Information', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.INFORMATION);
          break;
          
        case 'SETTINGS':
          Logger.info('TV Settings', this.accessory.displayName);
          await this.bravia.send(this.accessory.context.config.remote.SETTINGS);
          break;
          
        default:
          //fall through
          break;
    
      }
    
    } catch(err) {
    
      Logger.error('An error occured during sending command (' + state + ')', this.accessory.displayName);
      this.handleError(err);
    
    }
  
  }

  async handleInputs(){
                 
    try {
      await fs.ensureFile(this.api.user.storagePath() + '/bravia/' + this.fileName);  
      this.allInputs = await fs.readJson(this.api.user.storagePath() + '/bravia/' + this.fileName, { throws: false });
    } catch(err) {
      Logger.error('An error occured during reading inputs file', this.accessory.displayName);
      this.allInputs = {};
    }
  
    if(this.allInputs === null){
      Logger.debug('Init first start, fetching all inputs..', this.accessory.displayName);
      await this.updateInputs();
    } else if(this.accessory.context.config.refreshInputs){
      Logger.debug('Refreshing all inputs..', this.accessory.displayName);
      await this.updateInputs();
      try {
        const configJSON = await fs.readJson(this.api.user.storagePath() + '/config.json');
        for(const i in configJSON.platforms)
          if(configJSON.platforms[i].platform === 'BraviaOSPlatform'){
            for(const j in configJSON.platforms[i].tvs){
              if(configJSON.platforms[i].tvs[j].name === this.accessory.displayName){
                configJSON.platforms[i].tvs[j].refreshInputs = false;
              } 
            }
          }
        fs.writeJsonSync(this.api.user.storagePath() + '/config.json', configJSON, { spaces: 4 });
        Logger.info('"refreshInputs" setted to false!', this.accessory.displayName); 
      } catch(err){
        Logger.warn('There was an error reading/writing your config.json file', this.accessory.displayName);
        Logger.warn('Please change manually "refreshInputs" to false!', this.accessory.displayName);
        Logger.error(err);
      }
    } else {
      if(this.allInputs.apps && this.allInputs.apps.length){
        for(const app of this.allInputs.apps)
          this.apps.set(app.uri, app);
      } else {
        this.allInputs.apps = [];
      }
      if(this.allInputs.channels && this.allInputs.channels.length){
        for(const channel of this.allInputs.channels)
          this.channels.set(channel.uri, channel);
      } else {
        this.allInputs.channels = [];
      }
      if(this.allInputs.inputs && this.allInputs.inputs.length){
        for(const input of this.allInputs.inputs)
          this.inputs.set(input.uri, input);
      } else {
        this.allInputs.inputs = [];
      }
      if(this.allInputs.commands && this.allInputs.commands.length){
        for(const command of this.allInputs.commands){
          this.commands.set(command.name, command);
          this.commands.set(command.value, command);
        }
      } else {
        this.allInputs.commands = [];
      }
    }
    
    this.fetchedInputs = [];
    this.fetchedInputs = this.fetchedInputs.concat(this.allInputs.apps).concat(this.allInputs.channels).concat(this.allInputs.inputs).concat(this.allInputs.commands);
    
    return;
  
  }
  
  async updateInputs(){
  
    this.allInputs = {};
    
    //fetch all applications
    try {
      Logger.debug('Fetching all applications', this.accessory.displayName);
      let apps = await this.bravia.appControl.invoke('getApplicationList');
      await TIMEOUT(750);
      for(const app of apps){
        app.type = 'application';
        this.apps.set(app.uri, app);
      }  
      this.allInputs.apps = apps;
    } catch(err) {
      Logger.error('An error occured during fetching apps, skip..', this.accessory.displayName);
      this.handleError(err);
      this.allInputs.apps = this.allInputs.apps || [];
    }
    
    //fetch all inputs
    try {
      Logger.debug('Fetching all tv inputs', this.accessory.displayName);
      let powerState = await this.bravia.system.invoke('getPowerStatus');
      if(powerState.status !== 'active'){
        Logger.debug('TV is turned off, turning on to fetch all inputs..', this.accessory.displayName);
        Logger.debug(powerState, this.accessory.displayName);
        if(this.accessory.context.config.wol && this.accessory.context.config.mac){
          await this.bravia.wake(this.accessory.context.config.mac, false, true);
        } else {
          await this.bravia.wake();
        }
        await TIMEOUT(3000);
      }
      let inputs = await this.bravia.avContent.invoke('getCurrentExternalInputsStatus');
      await TIMEOUT(750);                 
      for(const input of inputs){
        input.type = 'input';
        this.inputs.set(input.uri, input);
      }
      this.allInputs.inputs = inputs;
      if(powerState.status !== 'active'){
        Logger.debug('Turning off tv..');
        await this.bravia.sleep();
        await TIMEOUT(750);
      }
    } catch(err) {
      Logger.error('An error occured during fetching tv inputs, skip..', this.accessory.displayName);
      this.handleError(err);
      this.allInputs.inputs = this.allInputs.inputs || [];
    }
    
    //fetch all channels
    let channelSources = ['tv:dvbt', 'tv:dvbc', 'tv:dvbs', 'tv:analog'];
    let allChannels = [];
    for(const source of channelSources){
      Logger.debug('Fetching all channels for ' + source, this.accessory.displayName);
      for(let i = 0; i <= 10; i++){ //max channels 10 * 200 for source
        try {
          Logger.debug('Fetching ' + (i+1) + '. list of channels', this.accessory.displayName);
          let channels = await this.bravia.avContent.invoke('getContentList', '1.2', {stIdx: i * 200, cnt: i * 200 + 200, source: source});
          await TIMEOUT(750);
          allChannels = allChannels.concat(channels);
          if(channels[channels.length-1].index !== 199){
            Logger.debug('Fetching ' + source + ' done.', this.accessory.displayName);
            break;
          }
        } catch(err) {
          if(!(err instanceof Error) && err.includes('Illegal Argument')){
            Logger.debug('Source ' + source + ' not found, skip..', this.accessory.displayName);
          } else if(Array.isArray(err)){
            if(err.includes(14) && err.includes('1.5')){
              Logger.debug('TV does not support fetching list for ' + source + ', skip..');
            } else {
              Logger.error('An error occured during fetching ' + source + ', skip..', this.accessory.displayName);
              this.handleError(err);
            }
          } else {
            Logger.error('An error occured during fetching ' + source + ', skip..', this.accessory.displayName);
            this.handleError(err);
          }
          break;
        }
      }
    }
    for(const channel of allChannels){
      channel.type = 'channel';
      this.channels.set(channel.uri, channel);
    }
    this.allInputs.channels = allChannels;

    //fetch all commands
    try {
      Logger.debug('Fetching all commands', this.accessory.displayName);
      let commands = await this.bravia.system.invoke('getRemoteControllerInfo');
      for(const command of commands){
        command.type = 'ircc';
        this.commands.set(command.name, command);
        this.commands.set(command.value, command);
      }
      this.allInputs.commands = commands;
    } catch(err) {
      Logger.error('An error occured during fetching commands, skip..', this.accessory.displayName);
      this.handleError(err); 
      this.allInputs.commands = this.allInputs.commands || [];
    }
    
    //store result
    try {
      await fs.writeJson(this.api.user.storagePath() + '/bravia/' + this.fileName, this.allInputs, {spaces: 2});
      Logger.debug('All inputs fetched! Stored to ' + (this.api.user.storagePath() + '/bravia/' + this.fileName), this.accessory.displayName);
    } catch(err) {
      Logger.error('An error occured during storing inputs! Restart homebridge or try again to update inputs.', this.accessory.displayName);
      Logger.error(err);
    }
    
    return;
  
  }
  
  configureInputs(){
  
    let inputSources = [];
    let inputSourceNames = [];
    
    this.accessory.context.config.inputs.forEach(input => {
    
      let i = 0;
    
      for(const [uri, config] of this.inputs){
       
        if(uri.includes(input) && !inputSourceNames.includes((config.title||config.label))){
          
          inputSourceNames.push((config.title||config.label));
          
          inputSources.push({
            name: config.title || config.label,
            identifier: this.getIndex('uri', input, i),
            type: 'input',
            subtype: (config.title || config.label).replace(/\s+/g, '').toLowerCase(),
            inputType: this.getInputSourceType(input),
            deviceType: this.getInputDeviceType(input)
          });
          
          i++;
         
        }
       
      }
    
    });
  
    this.accessory.context.config.apps.forEach(app => {
    
      for(const [uri, config] of this.apps){
       
        if(config.title === app && !inputSourceNames.includes(app)){
          
          inputSourceNames.push(app);

          inputSources.push({
            name: app,
            identifier: this.getIndex('title', app),
            type: 'app',
            subtype: app.replace(/\s+/g, '').toLowerCase(),
            inputType: this.getInputSourceType('app'),
            deviceType: this.getInputDeviceType('app')
          });

        }
       
      }
    
    });
    
    this.accessory.context.config.channels.forEach(channel => {
    
      for(const [uri, config] of this.channels){
       
        if(uri.includes(channel.source) && (config.index + 1) === channel.channel && !inputSourceNames.includes(uri)){
          
          inputSourceNames.push(uri);

          inputSources.push({
            name: config.title,
            identifier: this.getIndex('index', config.index.toString()),
            type: 'channel',
            subtype: config.title.replace(/\s+/g, '').toLowerCase(),
            inputType: this.getInputSourceType('channel'),
            deviceType: this.getInputDeviceType('channel')
          });
         
        }
       
      }
    
    });
    
    this.accessory.context.config.commands.forEach(command => {
    
      for(const [name, config] of this.commands){
       
        if(name === command && !inputSourceNames.includes(command)){
          
          inputSourceNames.push(command);
  
          inputSources.push({
            name: config.name,
            identifier: this.getIndex(command.includes('w==') ? 'value' : 'name', command),
            type: 'command',
            subtype: config.name.replace(/\s+/g, '').toLowerCase(),
            inputType: this.getInputSourceType('command'),
            deviceType: this.getInputDeviceType('command')
          });
         
        }
       
      }
    
    });
    
    return inputSources;
  
  }
  
  addInputServices(service, inputSources){
    
    inputSources.forEach(input => {
      
      Logger.debug('Adding new input', this.accessory.displayName);
      Logger.debug(input, this.accessory.displayName);
     
      const InputService = this.accessory.addService(this.api.hap.Service.InputSource, input.name, input.subtype);
     
      InputService
        .setCharacteristic(this.api.hap.Characteristic.Identifier, input.identifier)
        .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, input.name)
        .setCharacteristic(this.api.hap.Characteristic.IsConfigured, this.api.hap.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.api.hap.Characteristic.InputSourceType, input.inputType)
        .setCharacteristic(this.api.hap.Characteristic.InputDeviceType, input.deviceType);
        
      InputService.getCharacteristic(this.api.hap.Characteristic.CurrentVisibilityState)
        .on('get', callback => {     
          let state = this.accessory.context.config[input.name] || 0;
          callback(null, state);        
        });
      
      InputService.addCharacteristic(this.api.hap.Characteristic.TargetVisibilityState)
        .on('get', callback => {     
          let state = this.accessory.context.config[input.name] || 0;
          callback(null, state);
        })
        .on('set', (state, callback) => {
          this.accessory.context.config[input.name] = state;         
          InputService
            .getCharacteristic(this.api.hap.Characteristic.CurrentVisibilityState)
            .updateValue(state);     
          callback(null);
        });
   
      service.addLinkedService(InputService);
    
    });
    
  }
  
  sortInputServices(inputSources){
  
    const DisplayOrderTypes = {
      ARRAY_ELEMENT_START: 0x1,
      ARRAY_ELEMENT_END: 0x0,
    };
    
    let identifiersTLV = Buffer.alloc(0);
  
    let sources = {
      apps: inputSources.filter(source => source && source.type === 'app'),
      channels: inputSources.filter(source => source && source.type === 'channel'),
      commands: inputSources.filter(source => source && source.type === 'command'),
      inputs: inputSources.filter(source => source && source.type === 'input')
    };
    
    let displayOrder = this.accessory.context.config.displayOrder.map(catagory => {
      return sources[catagory];
    });
    
    displayOrder = displayOrder.flat();
    
    displayOrder.forEach(input => {
    
      if (identifiersTLV.length !== 0) {
        identifiersTLV = Buffer.concat([
          identifiersTLV,
          this.api.hap.encode(DisplayOrderTypes.ARRAY_ELEMENT_END, Buffer.alloc(0)),
        ]);
      }
      
      const element = this.api.hap.writeUInt32(input.identifier);
      identifiersTLV = Buffer.concat([
        identifiersTLV,
        this.api.hap.encode(DisplayOrderTypes.ARRAY_ELEMENT_START, element),
      ]);
    
    });
    
    this.accessory.getService(this.api.hap.Service.Television)
      .setCharacteristic(this.api.hap.Characteristic.DisplayOrder, identifiersTLV.toString('base64'));
  
  }
  
  getInputSourceType(type){
  
    switch(true) {
      case (type.indexOf('app') >= 0):
        return this.api.hap.Characteristic.InputSourceType.APPLICATION;
      case (type.indexOf('cec') >= 0):
        return this.api.hap.Characteristic.InputSourceType.HDMI; 
      case (type.indexOf('component') >= 0):
        return this.api.hap.Characteristic.InputSourceType.COMPONENT_VIDEO; 
      case (type.indexOf('channel') >= 0):
        return this.api.hap.Characteristic.InputSourceType.TUNER;
      case (type.indexOf('hdmi') >= 0):
        return this.api.hap.Characteristic.InputSourceType.HDMI; 
      case (type.indexOf('scart') >= 0):
        return this.api.hap.Characteristic.InputSourceType.S_VIDEO; 
      case (type.indexOf('widi') >= 0):
        return this.api.hap.Characteristic.InputSourceType.AIRPLAY; 
      case (type.indexOf('command') >= 0):
        return this.api.hap.Characteristic.InputSourceType.HOME_SCREEN; 
      default:
        return this.api.hap.Characteristic.InputSourceType.OTHER;
    }
  
  }
  
  getInputDeviceType(type){
  
    switch(true) {
      case (type.indexOf('cec') >= 0 || type.indexOf('hdmi') >= 0):
        return this.api.hap.Characteristic.InputDeviceType.PLAYBACK; 
      case (type.indexOf('channel') >= 0):
        return this.api.hap.Characteristic.InputDeviceType.TUNER;
      default:
        return this.api.hap.Characteristic.InputDeviceType.OTHER;
    }
  
  }
  
  getIndex(target, name, index){
    
    if(index !== undefined){
    
      let availableInputs = this.fetchedInputs.filter(input => input && input[target] && input[target].includes(name));
      let selectedInput = availableInputs[index];
      
      let identifier = this.fetchedInputs.map((input, index) => {
        if(input && input[target] === selectedInput[target]){
          return index;
        }
      }).filter(input => input);
      
      return identifier[0];    
      
    } else {
    
      let identifier = this.fetchedInputs.map((input, index) => {
        if(input && input[target] && input[target].toString().includes(name)){
          return index;
        }
      }).filter(input => input);
      
      return identifier[0];
    
    }
  
  }
  
  handleError(err){
  
    let service, on;
  
    let speakerAccessory = this.accessories.find(accessory => accessory.displayName === (this.accessory.displayName + ' Speaker'));  
  
    if(speakerAccessory){
    
      if(speakerAccessory.getService(this.api.hap.Service.Speaker)){
        service = this.api.hap.Service.Speaker;
        on = this.api.hap.Characteristic.Mute;
      } else if(speakerAccessory.getService(this.api.hap.Service.Lightbulb)){
        service = this.api.hap.Service.Lightbulb;
        on = this.api.hap.Characteristic.On;
      } else {
        service = this.api.hap.Service.Switch;
        on = this.api.hap.Characteristic.On;
      }
    
    } 
  
    if(err instanceof Error){
      if(err.code && err.code === 'ECONNABORTED'){
        Logger.warn('Timeout of ' + this.accessory.context.config.timeout + 's exceeded!', this.accessory.displayName);    
      } else if(err.code && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH' || err.code === 'ECONNRESET')){
        Logger.warn('Can not reach TV!', this.accessory.displayName);
      }
    } else if(Array.isArray(err)){
      if(err[0] === 40005 || err[1] === 'Display Is Turned off' || err[1] === 'not power-on'){
        Logger.debug(err, this.accessory.displayName);
        this.accessory
          .getService(this.api.hap.Service.Television)
          .getCharacteristic(this.api.hap.Characteristic.Active)
          .updateValue(0);
        if(speakerAccessory && !speakerAccessory.context.inProgress){
          speakerAccessory
            .getService(service)
            .getCharacteristic(on)
            .updateValue(on !== this.api.hap.Characteristic.Mute ? false : true);
        }
      } else {
        Logger.error('An error occured during polling tv', this.accessory.displayName);
        Logger.error(err);
      }
    } else {
      Logger.error('An error occured during polling tv', this.accessory.displayName);
      Logger.error(err);
    }
  
  }

}

module.exports = tvAccessory;
