
import React from 'react'
import ReactDOM from 'react-dom'

const remote = require('electron').remote;
const app = remote.app;
const path = require('path');
const shell = require('electron').shell;

export default class UnFile extends React.Component {

  constructor(props) {
    super(props);
    this.play = this.play.bind(this);
    this.add = this.add.bind(this);
    this.addMovie = this.addMovie.bind(this);

    this.state = {
      add: false
    }

    console.log(this.props.data._id);
  }

  play(e) {
    shell.openItem(this.props.data.path);
  }

  add(e) {
    this.setState({add: !this.state.add})
  }

  addMovie(e) {
    if (e.key === 'Enter') {
      console.log('do validate', e.target.value);
      this.props.onAdd(e.target.value, "", this.props.data.hash);
    }
  }

  render() {
  	let unfile = this.props.data;

    let unfilepath = path.parse(unfile.path);

    return (
	      <div className={"unfile " + (this.state.add ? 'add' : '') }>
          <div className="unfile-info">
            <div className="unfile-actions">
              <div className="unfile-add" onClick={this.add}></div>
              <div className="unfile-play" onClick={this.play}></div>
            </div>
            <div className="unfile-path">
              <div className="unfile-folder">{unfilepath.dir}</div>
              <div className="unfile-name">{unfilepath.base}</div>
            </div>
          </div>
          <div className={"unfile-add-form " + (this.state.add ? '' : 'hide') }>
            <input 
              id=""
              onKeyPress={this.addMovie} 
              placeholder="Type movie name and press enter ⏎" 
              ref={input => input && input.focus()} />
          </div>
        </div>
    );
  }
}
